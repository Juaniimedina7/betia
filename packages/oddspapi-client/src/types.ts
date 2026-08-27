export interface Sport {
  sportId: string;
  name: string;
}

export interface Tournament {
  tournamentId: string;
  sportId: string;
  name: string;
  countryCode?: string;
}

export interface OutcomePlayer {
  price: number;
  limit?: number;
  active?: boolean;
  changedAt?: string;
}

export interface Outcome {
  players: Record<string, OutcomePlayer>;
}

export interface Market {
  outcomes: Record<string, Outcome>;
}

export type BookmakerOdds = Record<string, { markets: Record<string, Market> }>;

export interface Fixture {
  fixtureId: string;
  sportId: string;
  tournamentId: string;
  seasonId?: string;
  participant1Id: string;
  participant2Id: string;
  participant1Name?: string;
  participant2Name?: string;
  startTime: string;
  statusId?: string;
  /** Whether OddsPapi currently has any bookmaker odds posted for this fixture. */
  hasOdds?: boolean;
  bookmakerOdds?: BookmakerOdds;
}

export interface HistoricalOddsPoint {
  fixtureId: string;
  bookmaker: string;
  marketId: string;
  outcomeId: string;
  price: number;
  recordedAt: string;
}

export interface ListFixturesParams {
  sportId?: string;
  tournamentId?: string;
  from?: string;
  to?: string;
  statusId?: string;
}

export interface GetOddsByTournamentParams {
  tournamentIds: string[];
  bookmaker?: string;
  oddsFormat?: "decimal" | "american" | "fractional";
}

export interface GetHistoricalOddsParams {
  fixtureId: string;
  marketId?: string;
  from?: string;
  to?: string;
}
