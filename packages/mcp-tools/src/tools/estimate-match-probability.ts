import { getDb, teamSeasonStats } from "@bet/db";
import { deriveLeagueAverage, estimateMatchProbabilities, type TeamGoalSplits } from "@bet/stats-engine";
import { and, eq, type InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import { resolveLeagueRef } from "../league-map";
import { getResolvedTeamId } from "../team-resolution";

type TeamSeasonStatsRow = InferSelectModel<typeof teamSeasonStats>;

export const estimateMatchProbabilityInput = z.object({
  homeTeam: z.string(),
  awayTeam: z.string(),
  sportKey: z.string(),
});

export type EstimateMatchProbabilityInput = z.infer<typeof estimateMatchProbabilityInput>;

const MIN_MATCHES_FOR_ESTIMATE = 3;

function homeSplits(row: TeamSeasonStatsRow): TeamGoalSplits {
  return { matchesPlayed: row.matchesPlayedHome, goalsFor: row.goalsForHome, goalsAgainst: row.goalsAgainstHome };
}

function awaySplits(row: TeamSeasonStatsRow): TeamGoalSplits {
  return { matchesPlayed: row.matchesPlayedAway, goalsFor: row.goalsForAway, goalsAgainst: row.goalsAgainstAway };
}

/**
 * Statistical (Poisson) win/draw/loss estimate from historical goals — completely
 * distinct from build_combo/get_best_price's market-implied "fair" probability.
 * Never calls Highlightly live; only reads what /api/ingest/poll-stats already
 * ingested (see CLAUDE.md's "Highlightly quota" section for the ingestion budget).
 */
export async function estimateMatchProbability(input: EstimateMatchProbabilityInput) {
  const league = resolveLeagueRef(input.sportKey);
  if (!league) {
    return { available: false as const, reason: "tournament_not_mapped" as const };
  }

  const [homeTeamId, awayTeamId] = await Promise.all([
    getResolvedTeamId(input.sportKey, input.homeTeam),
    getResolvedTeamId(input.sportKey, input.awayTeam),
  ]);

  if (!homeTeamId || !awayTeamId) {
    return { available: false as const, reason: "insufficient_data" as const };
  }

  const db = getDb();
  const leagueRows = await db
    .select()
    .from(teamSeasonStats)
    .where(and(eq(teamSeasonStats.leagueId, league.leagueId), eq(teamSeasonStats.season, league.season)));

  const homeRow = leagueRows.find((r) => r.externalTeamId === homeTeamId);
  const awayRow = leagueRows.find((r) => r.externalTeamId === awayTeamId);

  if (
    !homeRow ||
    !awayRow ||
    homeRow.matchesPlayedHome < MIN_MATCHES_FOR_ESTIMATE ||
    awayRow.matchesPlayedAway < MIN_MATCHES_FOR_ESTIMATE
  ) {
    return { available: false as const, reason: "insufficient_data" as const };
  }

  const leagueAverage = deriveLeagueAverage(
    leagueRows.map((r) => ({ home: homeSplits(r), away: awaySplits(r) })),
  );

  const estimate = estimateMatchProbabilities(homeSplits(homeRow), awaySplits(awayRow), leagueAverage);

  return {
    available: true as const,
    statisticalProbability: {
      homeWinProb: estimate.homeWinProb,
      drawProb: estimate.drawProb,
      awayWinProb: estimate.awayWinProb,
    },
    expectedGoals: { home: estimate.expectedHomeGoals, away: estimate.expectedAwayGoals },
    leagueAverageSource: leagueAverage.source,
    basedOn: {
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      homeMatchesPlayed: homeRow.matchesPlayedHome,
      awayMatchesPlayed: awayRow.matchesPlayedAway,
    },
  };
}
