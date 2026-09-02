export interface Sport {
  sportKey: string;
  group: string;
  title: string;
  description?: string;
  active?: boolean;
  hasOutrights?: boolean;
}

export interface OutcomeQuote {
  name: string;
  price: number;
  /** Line for spreads/totals markets (e.g. the handicap or the over/under total). Absent for h2h. */
  point?: number;
}

export interface MarketQuote {
  lastUpdate?: string;
  outcomes: OutcomeQuote[];
}

export interface BookmakerQuote {
  title: string;
  lastUpdate?: string;
  markets: Record<string, MarketQuote>;
}

/** Keyed by bookmaker key (e.g. "pinnacle"). */
export type BookmakerOdds = Record<string, BookmakerQuote>;

export interface Event {
  eventId: string;
  sportKey: string;
  sportTitle?: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakerOdds: BookmakerOdds;
}

export interface ListEventsParams {
  sportKey: string;
}

export interface GetSportOddsParams {
  sportKey: string;
  bookmakers: string[];
  markets?: string[];
  oddsFormat?: "decimal" | "american";
  dateFormat?: "iso" | "unix";
}

export interface GetEventOddsParams {
  sportKey: string;
  eventId: string;
  bookmakers?: string[];
  regions?: string[];
  markets?: string[];
  oddsFormat?: "decimal" | "american";
}

export interface QuotaSnapshot {
  remaining?: number;
  used?: number;
  last?: number;
}
