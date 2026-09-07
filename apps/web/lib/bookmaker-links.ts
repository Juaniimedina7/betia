/**
 * Fallback sportsbook homepages keyed by the bookmaker keys The Odds API uses, plus
 * the `af:`-prefixed keys packages/api-football-client mints for API-Football's
 * bookmakers (see that package's bookmakerKeyFor). Neither provider reliably returns
 * deep links for every bookmaker — when one's unavailable, the UI falls back to the
 * bookmaker's main sportsbook page so the user always has *somewhere* to click.
 *
 * Keep in sync with DEFAULT_BOOKMAKERS in apps/web/app/api/ingest/poll/route.ts for
 * the `pinnacle`.."betway" keys — narrowed to Argentina-facing books only (2026-09-07).
 * The `af:` entries are API-Football additions, kept to just `bet365`/`1xbet` (2026-09-07)
 * after that same Argentina-only decision — Bet365 is the actual gap-filler (not
 * available on The Odds API at all, confirmed 2026-09-02) and 1xBet has real Argentina
 * presence; API-Football's other global books (William Hill, Betfair, Marathonbet)
 * were deliberately left out to match the team's Argentina-only direction.
 */
export const BOOKMAKER_URLS: Record<string, string> = {
  pinnacle: "https://www.pinnacle.com/es/",
  betano_uk: "https://www.betano.bet.ar",
  codere_it: "https://www.codere.bet.ar",
  betsson: "https://www.betsson.bet.ar",
  betway: "https://betway.com",
  "af:bet365": "https://www.bet365.com",
  "af:1xbet": "https://1xbet.com",
};

/** Display-friendly name for a bookmaker key. */
export const BOOKMAKER_NAMES: Record<string, string> = {
  pinnacle: "Pinnacle",
  betano_uk: "Betano",
  codere_it: "Codere",
  betsson: "Betsson",
  betway: "Betway",
  "af:bet365": "Bet365",
  "af:1xbet": "1xBet",
};

/**
 * Returns the best available link for a leg: the API-provided deep link if it
 * exists, otherwise the bookmaker's sportsbook homepage.
 */
export function resolveBookmakerLink(deepLink?: string | null, bookmakerKey?: string): string | undefined {
  if (deepLink) return deepLink;
  if (bookmakerKey) return BOOKMAKER_URLS[bookmakerKey.toLowerCase()];
  return undefined;
}

/** Returns a display-friendly bookmaker name. */
export function bookmakerDisplayName(key: string): string {
  return BOOKMAKER_NAMES[key.toLowerCase()] ?? key;
}
