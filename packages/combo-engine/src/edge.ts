import type { CandidateLeg, RiskProfile } from "./types";

const MIN_EDGE_PCT_BY_PROFILE: Record<RiskProfile, number> = {
  conservative: 0, // still +EV, never a knowingly-negative-value pick — see MIN_PROBABILITY_CONSERVATIVE below
  balanced: -3, // allow slightly -EV legs to hit multiplier targets
  aggressive: -8,
  "safe-parlay": -8, // tolerate negative edge specifically to stack highly probable favorites
};

/**
 * "Conservative" means low-variance, not merely well-priced: a 23.00-odds underdog with
 * +33% edge used to pass the old edge-only floor despite having almost no real chance of
 * hitting. Require a high chance of actually happening too.
 *
 * The probability floor is keyed by the same `riskProfile` as the edge floor above — a
 * stricter profile also demands a higher real chance of happening, not just a better
 * edge tolerance. When the caller doesn't pick a `riskProfile` at all, `runSearch` in
 * ./search.ts resolves the probability floor against `conservative` specifically (0.8)
 * rather than against whatever the edge floor defaults to (`balanced`) — a deliberate
 * 2026-09-10 decision: no stated risk preference should still mean "the safe
 * probability," even though the edge floor itself keeps defaulting to `balanced`'s -3%
 * (needed for hitting multiplier targets, see MIN_EDGE_PCT_BY_PROFILE above).
 */
export const MIN_PROBABILITY_BY_PROFILE: Record<RiskProfile, number> = {
  conservative: 0.8, // 80% chance or more (odds <= 1.25)
  balanced: 0.25, // 25% chance or more (odds <= 4.0)
  aggressive: 0.05, // 5% chance or more (odds <= 20.0)
  "safe-parlay": 0.75, // 75% chance or more
};

/** Real chance of hitting: prefers the Poisson-model `statisticalProbability` when
 * available, falling back to the market-implied (de-vigged) `fairProbability` — same
 * preference order `rankByConfidence` uses. Exported so search.ts can report the
 * actual achieved probability when a requested floor can't be met (see
 * `runSearch`'s probability-floor fallback). */
export function bestProbabilityEstimate(leg: CandidateLeg): number {
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

/**
 * `minProbability`, when omitted, defaults to `riskProfile`'s own entry in
 * MIN_PROBABILITY_BY_PROFILE — callers that need the "no explicit riskProfile ->
 * conservative's floor" behavior (see the doc comment above) resolve that themselves
 * before calling this (see `runSearch` in ./search.ts) rather than relying on this
 * function's own default, since this function only ever sees one already-resolved
 * `riskProfile`.
 */
export function filterByRiskProfile(
  legs: CandidateLeg[],
  riskProfile: RiskProfile = "balanced",
  minProbability: number = MIN_PROBABILITY_BY_PROFILE[riskProfile],
): CandidateLeg[] {
  const baseEdgeFloor = MIN_EDGE_PCT_BY_PROFILE[riskProfile];
  return legs.filter((leg) => {
    const prob = bestProbabilityEstimate(leg);
    // Relax edge floor for high-probability legs (favorites)
    // because retail books have high vig on them, giving them negative edge vs Pinnacle.
    const edgeFloor = prob >= 0.8 ? Math.min(baseEdgeFloor, -8) : baseEdgeFloor;
    if (leg.edgePct < edgeFloor) return false;
    if (prob < minProbability) return false;
    return true;
  });
}
