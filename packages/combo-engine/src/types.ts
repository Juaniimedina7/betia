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
 * "conservative": still +EV (edge >=0%) AND a real (statistical or market-implied)
 * chance of hitting of at least 80% — low-variance picks, not just well-priced ones.
 * A >=5% edge floor on top of the probability floor was tried and rejected: clear
 * favorites (>=80% probability) essentially never clear positive edge in real cached
 * odds, so it made this profile return empty almost always.
 * "balanced"/"aggressive": edge-only floors (>=-3% / >=-8%), no probability floor.
 * See `filterByRiskProfile` in ./edge.ts for the exact thresholds.
 */
export type RiskProfile = "conservative" | "balanced" | "aggressive";

export interface BuildComboConstraints {
  targetMultiplier?: number;
  targetLegCount?: number;
  minLegs?: number;
  maxLegs?: number;
  excludeFixtureIds?: string[];
  riskProfile?: RiskProfile;
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
}
