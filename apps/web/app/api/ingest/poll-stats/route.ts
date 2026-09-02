import { getDb, oddsCache, teamHeadToHead, teamIdMap, teamSeasonStats } from "@bet/db";
import { getHighlightlyClient, HighlightlyError } from "@bet/highlightly-client";
import { buildTeamKey, LEAGUE_MAP } from "@bet/mcp-tools";
import { and, eq, inArray, sql } from "drizzle-orm";
import { resolveTeamName, type NamedTeamCandidate } from "@/lib/ingest/team-name-matching";
import { watchedSportKeys } from "@/lib/ingest/watched-sport-keys";

// Budget: Highlightly's BASIC plan is 100 requests/DAY, with no per-minute throttle
// observed in testing — see CLAUDE.md's "Highlightly quota" section. `/standings`
// returns every team's current-season home/away stats for an entire league in ONE
// call, so refreshing all 16 watched leagues every run costs a flat 16 requests —
// cheap enough to just always do, no staleness tracking needed for team stats at all.
// Head-to-head is still pairwise (one call per team pair), so that side keeps a
// staleness window + per-run cap: `1 run/day × (16 standings + 15 h2h) = 31
// requests/day`, well under the 100/day cap.
const MAX_H2H_FETCHES_PER_RUN = 15;
const MAX_CANDIDATE_FIXTURES = 150;

const H2H_STALE_MS = 14 * 24 * 60 * 60 * 1000;
const UNRESOLVED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

interface CandidateFixture {
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
}

interface ResolvedTeam {
  externalTeamId: string | null;
  updatedAt: Date;
}

function isStale(updatedAt: Date | null | undefined, staleMs: number): boolean {
  if (!updatedAt) return true;
  return Date.now() - updatedAt.getTime() > staleMs;
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  let client: ReturnType<typeof getHighlightlyClient>;
  try {
    client = getHighlightlyClient();
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }

  const db = getDb();
  const mappedSportKeys = watchedSportKeys().filter((key) => key in LEAGUE_MAP);

  const errors: { stage: string; sportKey?: string; message: string }[] = [];
  let leaguesRefreshed = 0;
  let teamsUpserted = 0;
  let h2hFetched = 0;

  if (mappedSportKeys.length === 0) {
    return Response.json({
      leaguesRefreshed,
      teamsUpserted,
      h2hFetched,
      errors,
      skipped: "no_mapped_sport_keys",
    });
  }

  try {
    const rows = await db
      .select({
        sportKey: oddsCache.sportKey,
        homeTeam: oddsCache.homeTeam,
        awayTeam: oddsCache.awayTeam,
      })
      .from(oddsCache)
      .where(inArray(oddsCache.sportKey, mappedSportKeys))
      .orderBy(oddsCache.commenceTime)
      .limit(MAX_CANDIDATE_FIXTURES);

    const candidateFixtures: CandidateFixture[] = rows.filter(
      (r): r is CandidateFixture => Boolean(r.sportKey && r.homeTeam && r.awayTeam),
    );

    // Group team names needing possible resolution, per sport_key. teamKey ->
    // teamName, since team_id_map is keyed by teamKey (sportKey + slugified name),
    // not a provider participant id (this odds provider has none).
    const teamsBySportKey = new Map<string, Map<string, string>>();
    for (const fx of candidateFixtures) {
      if (!teamsBySportKey.has(fx.sportKey)) teamsBySportKey.set(fx.sportKey, new Map());
      const byKey = teamsBySportKey.get(fx.sportKey)!;
      byKey.set(buildTeamKey(fx.sportKey, fx.homeTeam), fx.homeTeam);
      byKey.set(buildTeamKey(fx.sportKey, fx.awayTeam), fx.awayTeam);
    }

    const allTeamKeys = [...teamsBySportKey.values()].flatMap((m) => [...m.keys()]);
    const existingMapRows = allTeamKeys.length
      ? await db.select().from(teamIdMap).where(inArray(teamIdMap.teamKey, allTeamKeys))
      : [];
    const resolvedByTeamKey = new Map<string, ResolvedTeam>(
      existingMapRows.map((r) => [r.teamKey, { externalTeamId: r.externalTeamId, updatedAt: r.updatedAt }]),
    );

    // Refresh every mapped league's full standings — cheap (1 call/league), so no
    // staleness check, just always do it.
    for (const sportKey of mappedSportKeys) {
      const league = LEAGUE_MAP[sportKey]!;
      try {
        const standings = await client.getStandings({ leagueId: league.leagueId, season: league.season });
        leaguesRefreshed++;

        for (const team of standings) {
          await db
            .insert(teamSeasonStats)
            .values({
              externalTeamId: team.teamId,
              leagueId: team.leagueId,
              season: team.season,
              teamName: team.teamName,
              matchesPlayedHome: team.home.matchesPlayed,
              matchesPlayedAway: team.away.matchesPlayed,
              winsHome: team.home.wins,
              winsAway: team.away.wins,
              drawsHome: team.home.draws,
              drawsAway: team.away.draws,
              lossesHome: team.home.losses,
              lossesAway: team.away.losses,
              goalsForHome: team.home.goalsFor,
              goalsForAway: team.away.goalsFor,
              goalsAgainstHome: team.home.goalsAgainst,
              goalsAgainstAway: team.away.goalsAgainst,
              updatedAt: sql`now()`,
            })
            .onConflictDoUpdate({
              target: [teamSeasonStats.externalTeamId, teamSeasonStats.leagueId, teamSeasonStats.season],
              set: {
                teamName: team.teamName,
                matchesPlayedHome: team.home.matchesPlayed,
                matchesPlayedAway: team.away.matchesPlayed,
                winsHome: team.home.wins,
                winsAway: team.away.wins,
                drawsHome: team.home.draws,
                drawsAway: team.away.draws,
                lossesHome: team.home.losses,
                lossesAway: team.away.losses,
                goalsForHome: team.home.goalsFor,
                goalsForAway: team.away.goalsFor,
                goalsAgainstHome: team.home.goalsAgainst,
                goalsAgainstAway: team.away.goalsAgainst,
                updatedAt: sql`now()`,
              },
            });
          teamsUpserted++;
        }

        // Resolve any not-yet-resolved (or stale-unresolved) team names for this
        // sport_key against the roster we just pulled — no separate "list teams"
        // call needed, standings already gives us {teamId, name} for everyone.
        const teams = teamsBySportKey.get(sportKey);
        if (teams) {
          const candidates: NamedTeamCandidate[] = standings.map((s) => ({ teamId: s.teamId, name: s.teamName }));
          for (const [teamKey, name] of teams) {
            const existing = resolvedByTeamKey.get(teamKey);
            if (existing?.externalTeamId) continue;
            if (existing && !isStale(existing.updatedAt, UNRESOLVED_RETRY_MS)) continue;

            const match = resolveTeamName(name, candidates);
            await db
              .insert(teamIdMap)
              .values({
                teamKey,
                teamName: name,
                externalTeamId: match?.team.teamId ?? null,
                matchedTeamName: match?.team.name ?? null,
                matchStrategy: match ? match.strategy : "unresolved",
                matchConfidence: match ? String(match.confidence) : null,
                updatedAt: sql`now()`,
              })
              .onConflictDoUpdate({
                target: teamIdMap.teamKey,
                set: {
                  externalTeamId: match?.team.teamId ?? null,
                  matchedTeamName: match?.team.name ?? null,
                  matchStrategy: match ? match.strategy : "unresolved",
                  matchConfidence: match ? String(match.confidence) : null,
                  updatedAt: sql`now()`,
                },
              });
            resolvedByTeamKey.set(teamKey, { externalTeamId: match?.team.teamId ?? null, updatedAt: new Date() });
          }
        }
      } catch (err) {
        errors.push({
          stage: "standings",
          sportKey,
          message: err instanceof HighlightlyError ? err.message : String(err),
        });
      }
    }

    // Head-to-head refresh, capped at MAX_H2H_FETCHES_PER_RUN.
    const seenPairs = new Set<string>();
    for (const fx of candidateFixtures) {
      if (h2hFetched >= MAX_H2H_FETCHES_PER_RUN) break;

      const team1Id = resolvedByTeamKey.get(buildTeamKey(fx.sportKey, fx.homeTeam))?.externalTeamId;
      const team2Id = resolvedByTeamKey.get(buildTeamKey(fx.sportKey, fx.awayTeam))?.externalTeamId;
      if (!team1Id || !team2Id) continue;

      const [teamAId, teamBId] = team1Id < team2Id ? [team1Id, team2Id] : [team2Id, team1Id];
      const pairKey = `${teamAId}:${teamBId}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const [existingH2h] = await db
        .select({ updatedAt: teamHeadToHead.updatedAt })
        .from(teamHeadToHead)
        .where(and(eq(teamHeadToHead.teamAId, teamAId), eq(teamHeadToHead.teamBId, teamBId)))
        .limit(1);

      if (!isStale(existingH2h?.updatedAt, H2H_STALE_MS)) continue;

      try {
        const fixtures = await client.getHeadToHead({ team1Id: teamAId, team2Id: teamBId });
        let teamAWins = 0;
        let teamBWins = 0;
        let draws = 0;
        let teamAGoalsFor = 0;
        let teamBGoalsFor = 0;
        let lastMeetingAt: string | null = null;

        for (const f of fixtures) {
          const homeIsA = f.homeTeamId === teamAId;
          const aGoals = homeIsA ? f.homeGoals : f.awayGoals;
          const bGoals = homeIsA ? f.awayGoals : f.homeGoals;
          if (aGoals !== null) teamAGoalsFor += aGoals;
          if (bGoals !== null) teamBGoalsFor += bGoals;
          if (aGoals !== null && bGoals !== null) {
            if (aGoals > bGoals) teamAWins++;
            else if (aGoals < bGoals) teamBWins++;
            else draws++;
          }
          if (!lastMeetingAt || f.date > lastMeetingAt) lastMeetingAt = f.date;
        }

        await db
          .insert(teamHeadToHead)
          .values({
            teamAId,
            teamBId,
            matchesPlayed: fixtures.length,
            teamAWins,
            teamBWins,
            draws,
            teamAGoalsFor,
            teamBGoalsFor,
            lastMeetingAt: lastMeetingAt ? new Date(lastMeetingAt) : null,
            updatedAt: sql`now()`,
          })
          .onConflictDoUpdate({
            target: [teamHeadToHead.teamAId, teamHeadToHead.teamBId],
            set: {
              matchesPlayed: fixtures.length,
              teamAWins,
              teamBWins,
              draws,
              teamAGoalsFor,
              teamBGoalsFor,
              lastMeetingAt: lastMeetingAt ? new Date(lastMeetingAt) : null,
              updatedAt: sql`now()`,
            },
          });
        h2hFetched++;
      } catch (err) {
        errors.push({ stage: "head_to_head", message: err instanceof HighlightlyError ? err.message : String(err) });
      }
    }

    return Response.json({ leaguesRefreshed, teamsUpserted, h2hFetched, errors });
  } catch (err) {
    return Response.json(
      { leaguesRefreshed, teamsUpserted, h2hFetched, errors: [...errors, { stage: "fatal", message: String(err) }] },
      { status: 502 },
    );
  }
}
