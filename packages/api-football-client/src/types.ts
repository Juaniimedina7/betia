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

/**
 * One fixture from `GET /fixtures?date=` discovery, before any odds are fetched —
 * see `ApiFootballClient.findFixturesByDate`. `getOddsForLeagues` builds on top of
 * this for the odds-ingest path; `/api/ingest/settle` uses it standalone to resolve a
 * "legacy" (pre-provider-migration) fixtureId to a real API-Football fixture id by
 * team name + kickoff time, without also paying for an `/odds` call it doesn't need.
 */
export interface ApiFootballFixtureSummary {
  fixtureId: string;
  leagueId: number;
  /** ISO 8601, from the fixture's own `fixture.date`. */
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
}

export interface QuotaSnapshot {
  /** From x-ratelimit-requests-remaining (daily cap). */
  remainingDay?: number;
  /** From x-ratelimit-remaining (per-minute cap, currently 10/min on the Free plan). */
  remainingMinute?: number;
}

/**
 * Match result for one fixture, from `GET /fixtures?ids=`. `statusShort` is
 * API-Football's own status code (e.g. "FT", "AET", "PEN" = finished with a valid
 * score; "PST"/"CANC"/"ABD" = won't produce a valid score; anything else = not
 * finished yet) — see FINISHED_STATUSES/UNPLAYED_STATUSES in index.ts for how these
 * get interpreted. Goals are null while the match hasn't started or is still in
 * progress.
 */
export interface ApiFootballFixtureResult {
  fixtureId: string;
  statusShort: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number | null;
  awayGoals: number | null;
  /** From `score.halftime` — needed to grade halftime-dependent markets (odd_even
   * doesn't need this, it's derivable from the fulltime goals alone; see
   * apps/web/lib/settlement/grade-non-h2h-leg.ts). Null under the same conditions as
   * homeGoals/awayGoals (not started/in progress), or for a competition that doesn't
   * report a halftime score. */
  homeGoalsHalftime: number | null;
  awayGoalsHalftime: number | null;
}

/**
 * Whether each side missed a penalty during the match, from `GET /fixtures/events?fixture=`
 * — used to grade the "to_miss_a_penalty" market (see
 * apps/web/lib/settlement/grade-non-h2h-leg.ts). A "Missed Penalty" event is API-Football's
 * own vocabulary (`type: "Goal", detail: "Missed Penalty"`, confirmed live 2026-09-09) — a
 * penalty attempt is always recorded as a "Goal"-type event regardless of outcome.
 *
 * Note: this endpoint doesn't report fixture status — the caller is expected to already
 * have that from a companion ApiFootballFixtureResult for the same fixture (settle/route.ts
 * only ever requests events for a fixture it's also requesting results for).
 */
export interface ApiFootballFixtureEvents {
  fixtureId: string;
  missedPenaltyByTeam: { home: boolean; away: boolean };
}

/**
 * Each side's total shots for the match, from `GET /fixtures/statistics?fixture=` — used
 * to grade the "shots_1x2" market (see apps/web/lib/settlement/grade-non-h2h-leg.ts). Null
 * when API-Football doesn't report statistics for this fixture (common for lower-tier
 * competitions) — not the same as 0 shots, so callers must leave it pending rather than
 * guess.
 *
 * Note: like ApiFootballFixtureEvents, this endpoint doesn't report fixture status either.
 */
export interface ApiFootballFixtureStatistics {
  fixtureId: string;
  homeTotalShots: number | null;
  awayTotalShots: number | null;
}
