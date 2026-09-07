export interface ApiFootballOutcome {
  /**
   * The raw value string API-Football returns (e.g. "Home", "Draw", "Over 2.5",
   * "Home -0.5"). For the "Match Winner" market this gets normalized to the actual
   * team name (see normalizeMatchWinnerOutcome in index.ts) so it lines up with The
   * Odds API's h2h outcome shape; every other market keeps the raw descriptive string
   * as-is (it already reads fine in Spanish via market-labels.ts's fallback, and
   * splitting out a numeric `point` the way The Odds API does isn't attempted here —
   * see the package README-less design note in index.ts).
   */
  name: string;
  price: number;
}

export interface ApiFootballMarketQuote {
  outcomes: ApiFootballOutcome[];
}

/**
 * Shape-compatible with @bet/odds-api-client's BookmakerQuote (same `title`/`markets`
 * fields) so ingest can merge these into the same odds_cache.bookmaker_odds jsonb
 * blob without a translation layer. Keyed by a `af:`-prefixed bookmaker slug (e.g.
 * "af:bet365") so it can never collide with a The Odds API bookmaker key in the same
 * blob (both providers have a bookmaker literally named "Pinnacle").
 */
export interface ApiFootballBookmakerQuote {
  title: string;
  markets: Record<string, ApiFootballMarketQuote>;
}

export type ApiFootballBookmakerOdds = Record<string, ApiFootballBookmakerQuote>;

export interface ApiFootballFixtureOdds {
  fixtureId: string;
  leagueId: number;
  /** ISO 8601, from the fixture's own `fixture.date`. */
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakerOdds: ApiFootballBookmakerOdds;
}

export interface QuotaSnapshot {
  /** From x-ratelimit-requests-remaining (daily cap). */
  remainingDay?: number;
  /** From x-ratelimit-remaining (per-minute cap, currently 10/min on the Free plan). */
  remainingMinute?: number;
}
