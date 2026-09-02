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
}

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
  toleranceMet: boolean;
  warning?: string;
}
