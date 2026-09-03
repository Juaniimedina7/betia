import { z } from "zod";
import { resolveLeagueRef } from "../league-map";
import { estimateMatchProbabilitiesBatch, fixtureKey } from "../statistical-probability";

export const estimateMatchProbabilityInput = z.object({
  homeTeam: z.string(),
  awayTeam: z.string(),
  sportKey: z.string(),
});

export type EstimateMatchProbabilityInput = z.infer<typeof estimateMatchProbabilityInput>;

/**
 * Statistical (Poisson) win/draw/loss estimate from historical goals — completely
 * distinct from build_combo/get_best_price's market-implied "fair" probability.
 * Never calls Highlightly live; only reads what /api/ingest/poll-stats already
 * ingested (see CLAUDE.md's "Highlightly quota" section for the ingestion budget).
 */
export async function estimateMatchProbability(input: EstimateMatchProbabilityInput) {
  if (!resolveLeagueRef(input.sportKey)) {
    return { available: false as const, reason: "tournament_not_mapped" as const };
  }

  const fixture = { sportKey: input.sportKey, homeTeam: input.homeTeam, awayTeam: input.awayTeam };
  const results = await estimateMatchProbabilitiesBatch([fixture]);
  const estimate = results.get(fixtureKey(fixture));

  if (!estimate) {
    return { available: false as const, reason: "insufficient_data" as const };
  }

  return {
    available: true as const,
    statisticalProbability: {
      homeWinProb: estimate.homeWinProb,
      drawProb: estimate.drawProb,
      awayWinProb: estimate.awayWinProb,
    },
    expectedGoals: estimate.expectedGoals,
    leagueAverageSource: estimate.leagueAverageSource,
    basedOn: estimate.basedOn,
  };
}
