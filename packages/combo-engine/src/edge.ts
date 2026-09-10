import type { CandidateLeg, RiskProfile } from "./types";

const MIN_EDGE_PCT_BY_PROFILE: Record<RiskProfile, number> = {
  conservative: 0, // still +EV, never a knowingly-negative-value pick — see MIN_PROBABILITY_CONSERVATIVE below
  balanced: -3, // allow slightly -EV legs to hit multiplier targets
  aggressive: -8,
};

/**
 * "Conservative" means low-variance, not merely well-priced: a 23.00-odds underdog with
 * +33% edge used to pass the old edge-only floor despite having almost no real chance of
 * hitting. Require a high chance of actually happening too.
 *
 * All profiles now enforce a probability floor to prevent returning extreme longshots
 * like "miss a penalty" that have positive edge but almost zero real chance of hitting.
 */
const MIN_PROBABILITY_BY_PROFILE: Record<RiskProfile, number> = {
  conservative: 0.8, // 80% chance or more (odds <= 1.25)
  balanced: 0.25,    // 25% chance or more (odds <= 4.0)
  aggressive: 0.05,  // 5% chance or more (odds <= 20.0)
};

/** Real chance of hitting: prefers the Poisson-model `statisticalProbability` when
 * available, falling back to the market-implied (de-vigged) `fairProbability` — same
 * preference order `rankByConfidence` uses. */
function bestProbabilityEstimate(leg: CandidateLeg): number {
  return leg.statisticalProbability ?? leg.fairProbability;
}

export function rankByEdge(legs: CandidateLeg[]): CandidateLeg[] {
  return [...legs].sort((a, b) => b.edgePct - a.edgePct);
}

/**
 * Ranks legs by real chance of hitting first: higher `statisticalProbability` wins: legs
 * without a statistical estimate (unmapped sport, insufficient data, non-h2h market)
 * sort after every leg that has one, falling back to `edgePct` as the tiebreaker among
 * themselves. This is the primary ordering `buildCombo` uses to pick candidates — it
 * always searches for the most-likely-to-happen selection first, only leaning on market
 * edge where no statistical read exists.
 */
export function rankByConfidence(legs: CandidateLeg[]): CandidateLeg[] {
  return [...legs].sort((a, b) => {
    const aHas = a.statisticalProbability !== undefined;
    const bHas = b.statisticalProbability !== undefined;
    if (aHas && bHas) return b.statisticalProbability! - a.statisticalProbability!;
    if (aHas !== bHas) return aHas ? -1 : 1;
    return b.edgePct - a.edgePct;
  });
}

export function filterByRiskProfile(
  legs: CandidateLeg[],
  riskProfile: RiskProfile = "balanced",
  minProbability?: number,
): CandidateLeg[] {
  const edgeFloor = MIN_EDGE_PCT_BY_PROFILE[riskProfile];
  const probFloor = minProbability !== undefined ? minProbability : MIN_PROBABILITY_BY_PROFILE[riskProfile];
  return legs.filter((leg) => {
    if (leg.edgePct < edgeFloor) return false;
    if (bestProbabilityEstimate(leg) < probFloor) return false;
    return true;
  });
}
