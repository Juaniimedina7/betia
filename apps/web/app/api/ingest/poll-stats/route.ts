import { getDb, oddsCache, teamHeadToHead, teamIdMap, teamSeasonStats } from "@bet/db";
import { getHighlightlyClient, HighlightlyError } from "@bet/highlightly-client";
import { LEAGUE_MAP } from "@bet/mcp-tools";
import { and, eq, inArray, sql } from "drizzle-orm";
import { resolveTeamName, type NamedTeamCandidate } from "@/lib/ingest/team-name-matching";
import { watchedTournamentIds } from "@/lib/ingest/watched-tournaments";

// Budget: Highlightly's BASIC plan is 100 requests/DAY, with no per-minute throttle
// observed in testing (unlike the OddsPapi/API-Football providers elsewhere in this
// repo) — see CLAUDE.md's "Highlightly quota" section. `/standings` returns every
// team's current-season home/away stats for an entire league in ONE call, so
// refreshing all 20 watched tournaments every run costs a flat 20 requests — cheap
// enough to just always do, no staleness tracking needed for team stats at all.
// Head-to-head is still pairwise (one call per team pair), so that side keeps a
// staleness window + per-run cap: `2 runs/day × (20 standings + 15 h2h) = 70
// requests/day`, leaving ~30/day headroom for manual reruns.
const MAX_H2H_FETCHES_PER_RUN = 15;
const MAX_CANDIDATE_FIXTURES = 150;

const H2H_STALE_MS = 14 * 24 * 60 * 60 * 1000;
const UNRESOLVED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

interface CandidateFixture {
  tournamentId: string;
  participant1Id: string;
  participant2Id: string;
  participant1Name: string;
  participant2Name: string;
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
  const mappedTournamentIds = watchedTournamentIds().filter((id) => id in LEAGUE_MAP);

  const errors: { stage: string; tournamentId?: string; message: string }[] = [];
  let leaguesRefreshed = 0;
  let teamsUpserted = 0;
  let h2hFetched = 0;

  if (mappedTournamentIds.length === 0) {
    return Response.json({
      leaguesRefreshed,
      teamsUpserted,
      h2hFetched,
      errors,
      skipped: "no_mapped_tournaments",
    });
  }

  try {
    const rows = await db
      .select({
        tournamentId: oddsCache.tournamentId,
        participant1Id: oddsCache.participant1Id,
        participant2Id: oddsCache.participant2Id,
        participant1Name: oddsCache.participant1Name,
        participant2Name: oddsCache.participant2Name,
      })
      .from(oddsCache)
      .where(inArray(oddsCache.tournamentId, mappedTournamentIds))
      .orderBy(oddsCache.startTime)
      .limit(MAX_CANDIDATE_FIXTURES);

    const candidateFixtures: CandidateFixture[] = rows.filter(
      (r): r is CandidateFixture =>
        Boolean(r.tournamentId && r.participant1Id && r.participant2Id && r.participant1Name && r.participant2Name),
    );

    // Group participants (id -> name) needing possible resolution, per tournament.
    const participantsByTournament = new Map<string, Map<string, string>>();
    for (const fx of candidateFixtures) {
      if (!participantsByTournament.has(fx.tournamentId)) participantsByTournament.set(fx.tournamentId, new Map());
      const byId = participantsByTournament.get(fx.tournamentId)!;
      byId.set(fx.participant1Id, fx.participant1Name);
      byId.set(fx.participant2Id, fx.participant2Name);
    }

    const allParticipantIds = [...new Set(candidateFixtures.flatMap((f) => [f.participant1Id, f.participant2Id]))];
    const existingMapRows = allParticipantIds.length
      ? await db.select().from(teamIdMap).where(inArray(teamIdMap.oddsPapiParticipantId, allParticipantIds))
      : [];
    const resolvedByParticipant = new Map<string, ResolvedTeam>(
      existingMapRows.map((r) => [r.oddsPapiParticipantId, { externalTeamId: r.externalTeamId, updatedAt: r.updatedAt }]),
    );

    // Refresh every mapped league's full standings — cheap (1 call/league), so no
    // staleness check, just always do it.
    for (const tournamentId of mappedTournamentIds) {
      const league = LEAGUE_MAP[tournamentId]!;
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

        // Resolve any not-yet-resolved (or stale-unresolved) participants for this
        // tournament against the roster we just pulled — no separate "list teams"
        // call needed, standings already gives us {teamId, name} for everyone.
        const participants = participantsByTournament.get(tournamentId);
        if (participants) {
          const candidates: NamedTeamCandidate[] = standings.map((s) => ({ teamId: s.teamId, name: s.teamName }));
          for (const [participantId, name] of participants) {
            const existing = resolvedByParticipant.get(participantId);
            if (existing?.externalTeamId) continue;
            if (existing && !isStale(existing.updatedAt, UNRESOLVED_RETRY_MS)) continue;

            const match = resolveTeamName(name, candidates);
            await db
              .insert(teamIdMap)
              .values({
                oddsPapiParticipantId: participantId,
                participantName: name,
                externalTeamId: match?.team.teamId ?? null,
                matchedTeamName: match?.team.name ?? null,
                matchStrategy: match ? match.strategy : "unresolved",
                matchConfidence: match ? String(match.confidence) : null,
                updatedAt: sql`now()`,
              })
              .onConflictDoUpdate({
                target: teamIdMap.oddsPapiParticipantId,
                set: {
                  externalTeamId: match?.team.teamId ?? null,
                  matchedTeamName: match?.team.name ?? null,
                  matchStrategy: match ? match.strategy : "unresolved",
                  matchConfidence: match ? String(match.confidence) : null,
                  updatedAt: sql`now()`,
                },
              });
            resolvedByParticipant.set(participantId, { externalTeamId: match?.team.teamId ?? null, updatedAt: new Date() });
          }
        }
      } catch (err) {
        errors.push({
          stage: "standings",
          tournamentId,
          message: err instanceof HighlightlyError ? err.message : String(err),
        });
      }
    }

    // Head-to-head refresh, capped at MAX_H2H_FETCHES_PER_RUN.
    const seenPairs = new Set<string>();
    for (const fx of candidateFixtures) {
      if (h2hFetched >= MAX_H2H_FETCHES_PER_RUN) break;

      const team1Id = resolvedByParticipant.get(fx.participant1Id)?.externalTeamId;
      const team2Id = resolvedByParticipant.get(fx.participant2Id)?.externalTeamId;
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
