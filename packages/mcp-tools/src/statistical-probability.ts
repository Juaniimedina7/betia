import { getDb, teamSeasonStats } from "@bet/db";
import { deriveLeagueAverage, estimateMatchProbabilities, type TeamGoalSplits } from "@bet/stats-engine";
import { and, eq, type InferSelectModel } from "drizzle-orm";
import { resolveLeagueRef } from "./league-map";
import { getResolvedTeamId } from "./team-resolution";

type TeamSeasonStatsRow = InferSelectModel<typeof teamSeasonStats>;

const MIN_MATCHES_FOR_ESTIMATE = 3;

export interface FixtureRef {
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
}

export interface StatisticalProbabilityResult {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  expectedGoals: { home: number; away: number };
  leagueAverageSource: "computed" | "fallback";
  basedOn: {
    homeTeam: string;
    awayTeam: string;
    homeMatchesPlayed: number;
    awayMatchesPlayed: number;
  };
}

export function fixtureKey(fixture: FixtureRef): string {
  return `${fixture.sportKey}|${fixture.homeTeam}|${fixture.awayTeam}`;
}

function homeSplits(row: TeamSeasonStatsRow): TeamGoalSplits {
  return { matchesPlayed: row.matchesPlayedHome, goalsFor: row.goalsForHome, goalsAgainst: row.goalsAgainstHome };
}

function awaySplits(row: TeamSeasonStatsRow): TeamGoalSplits {
  return { matchesPlayed: row.matchesPlayedAway, goalsFor: row.goalsForAway, goalsAgainst: row.goalsAgainstAway };
}

/**
 * Batch version of the per-fixture Poisson estimate (see estimate-match-probability.ts,
 * which wraps a single-fixture call to this). Groups DB reads by league so N candidate
 * legs from build_combo don't turn into N separate teamSeasonStats round-trips — one
 * query per distinct (leagueId, season) among the given fixtures, not one per fixture.
 * Fixtures on an unmapped sportKey (no LEAGUE_MAP entry, e.g. NBA/NFL/tennis) or without
 * enough historical data are simply absent from the returned map — never thrown.
 */
export async function estimateMatchProbabilitiesBatch(
  fixtures: FixtureRef[],
): Promise<Map<string, StatisticalProbabilityResult>> {
  const results = new Map<string, StatisticalProbabilityResult>();
  const db = getDb();

  const byLeague = new Map<string, { leagueId: string; season: string; fixtures: FixtureRef[] }>();
  for (const fixture of fixtures) {
    const league = resolveLeagueRef(fixture.sportKey);
    if (!league) continue;
    const leagueKey = `${league.leagueId}:${league.season}`;
    const entry = byLeague.get(leagueKey) ?? { ...league, fixtures: [] };
    entry.fixtures.push(fixture);
    byLeague.set(leagueKey, entry);
  }

  for (const { leagueId, season, fixtures: leagueFixtures } of byLeague.values()) {
    const leagueRows = await db
      .select()
      .from(teamSeasonStats)
      .where(and(eq(teamSeasonStats.leagueId, leagueId), eq(teamSeasonStats.season, season)));
    if (leagueRows.length === 0) continue;

    const leagueAverage = deriveLeagueAverage(leagueRows.map((r) => ({ home: homeSplits(r), away: awaySplits(r) })));
    const rowsByExternalId = new Map(leagueRows.map((r) => [r.externalTeamId, r]));

    const teamIdCache = new Map<string, Promise<string | null>>();
    function resolveTeamId(sportKey: string, teamName: string): Promise<string | null> {
      const key = `${sportKey}|${teamName}`;
      let pending = teamIdCache.get(key);
      if (!pending) {
        pending = getResolvedTeamId(sportKey, teamName);
        teamIdCache.set(key, pending);
      }
      return pending;
    }

    await Promise.all(
      leagueFixtures.map(async (fixture) => {
        const [homeTeamId, awayTeamId] = await Promise.all([
          resolveTeamId(fixture.sportKey, fixture.homeTeam),
          resolveTeamId(fixture.sportKey, fixture.awayTeam),
        ]);
        if (!homeTeamId || !awayTeamId) return;

        const homeRow = rowsByExternalId.get(homeTeamId);
        const awayRow = rowsByExternalId.get(awayTeamId);
        if (!homeRow || !awayRow) return;
        if (
          homeRow.matchesPlayedHome < MIN_MATCHES_FOR_ESTIMATE ||
          awayRow.matchesPlayedAway < MIN_MATCHES_FOR_ESTIMATE
        ) {
          return;
        }

        const estimate = estimateMatchProbabilities(homeSplits(homeRow), awaySplits(awayRow), leagueAverage);
        results.set(fixtureKey(fixture), {
          homeWinProb: estimate.homeWinProb,
          drawProb: estimate.drawProb,
          awayWinProb: estimate.awayWinProb,
          expectedGoals: { home: estimate.expectedHomeGoals, away: estimate.expectedAwayGoals },
          leagueAverageSource: leagueAverage.source,
          basedOn: {
            homeTeam: fixture.homeTeam,
            awayTeam: fixture.awayTeam,
            homeMatchesPlayed: homeRow.matchesPlayedHome,
            awayMatchesPlayed: awayRow.matchesPlayedAway,
          },
        });
      }),
    );
  }

  return results;
}
