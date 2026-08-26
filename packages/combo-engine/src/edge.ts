import type { CandidateLeg, RiskProfile } from "./types";

const MIN_EDGE_PCT_BY_PROFILE: Record<RiskProfile, number> = {
  conservative: 0, // only +EV legs
  balanced: -3, // allow slightly -EV legs to hit multiplier targets
  aggressive: -8,
};

export function rankByEdge(legs: CandidateLeg[]): CandidateLeg[] {
  return [...legs].sort((a, b) => b.edgePct - a.edgePct);
}

export function filterByRiskProfile(
  legs: CandidateLeg[],
  riskProfile: RiskProfile = "balanced",
): CandidateLeg[] {
  const floor = MIN_EDGE_PCT_BY_PROFILE[riskProfile];
  return legs.filter((leg) => leg.edgePct >= floor);
}
