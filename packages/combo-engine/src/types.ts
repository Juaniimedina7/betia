export interface CandidateLeg {
  fixtureId: string;
  sportKey: string;
  homeTeam?: string;
  awayTeam?: string;
  startTime: string;
  marketId: string;
  outcomeName: string;
  /** Line for spreads/totals markets (the handicap or the over/under total). Absent for h2h. */
  point?: number;
  selectionLabel: string;
  bookmaker: string;
  priceDecimal: number;
  fairPriceDecimal: number;
  fairProbability: number;
  edgePct: number;
  /** Poisson-model probability (0-1) that this specific outcome happens, when computable
   * (h2h market, sport mapped in LEAGUE_MAP, enough historical data) — completely
   * distinct from `fairProbability`'s market-implied de-vig number. Undefined for
   * spreads/totals or unmapped sports (NBA/NFL/tennis today). */
  statisticalProbability?: number;
  /** Deep link pointing directly to the event/market on the bookmaker's site. */
  deepLink?: string;
}

/**
 * Each profile pairs an edge floor with its own probability floor — a stricter profile
 * demands both a better price AND a higher real chance of happening, not one or the
 * other. "conservative": edge >=0% AND >=80% real chance of hitting (low-variance,
 * high-confidence picks) — a >=5% edge floor on top of the probability floor was tried
 * and rejected: clear favorites (>=80% probability) essentially never clear positive
 * edge in real cached odds, so it made this profile return empty almost always.
 * "balanced" (default): edge >=-3% AND >=25% real chance. "aggressive": edge >=-8% AND
 * >=5% real chance (avoids picking extreme longshots with positive edge but almost
 * zero real chance of hitting). When the caller doesn't pick a profile at all, the edge
 * floor still defaults to "balanced" but the probability floor defaults to
 * "conservative"'s (0.8) instead — see `runSearch` in ./search.ts. See
 * `filterByRiskProfile`/`MIN_PROBABILITY_BY_PROFILE` in ./edge.ts for the exact
 * thresholds.
 */
export type RiskProfile = "conservative" | "balanced" | "aggressive" | "safe-parlay";

export interface BuildComboConstraints {
  targetMultiplier?: number;
  targetLegCount?: number;
  minLegs?: number;
  maxLegs?: number;
  excludeFixtureIds?: string[];
  includeFixtureIds?: string[];
  riskProfile?: RiskProfile;
  /**
   * Explicit minimum probability (0-1) for each leg, overriding the risk profile's own
   * floor (see `MIN_PROBABILITY_BY_PROFILE` in ./edge.ts). When omitted, the floor
   * comes from `riskProfile` — or, if `riskProfile` itself is also omitted, from
   * "conservative" specifically (0.8), not "balanced" (see `runSearch` in ./search.ts).
   */
  minProbability?: number;
  /** Fractional tolerance around targetMultiplier, e.g. 0.15 = +/-15%. */
  tolerance?: number;
}

export interface ComboResult {
  legs: CandidateLeg[];
  combinedOddsDecimal: number;
  legCount: number;
  averageEdgePct: number;
  /** Average `statisticalProbability` over only the legs that have one — undefined if
   * none of the legs in this combo have a statistical estimate. */
  averageStatisticalProbability?: number;
  toleranceMet: boolean;
  warning?: string;
  /** Set by build-combo.ts's fixtureId (same-match) path, always — see
   * buildSameMatchCombo's doc comment in search.ts for why this is never omitted
   * there: same-match legs are correlated in reality and this engine's combined-odds
   * math doesn't account for that. Absent for the normal cross-fixture combo path. */
  disclaimer?: string;
}
