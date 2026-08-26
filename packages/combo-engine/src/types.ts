export interface CandidateLeg {
  fixtureId: string;
  sportId: string;
  tournamentId: string;
  participant1Id: string;
  participant2Id: string;
  participant1Name?: string;
  participant2Name?: string;
  startTime: string;
  marketId: string;
  outcomeId: string;
  playerIdx: string;
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
