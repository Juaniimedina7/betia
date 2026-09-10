/**
 * Fallback sportsbook homepages keyed by the bookmaker keys The Odds API uses, plus
 * the `af:`-prefixed keys packages/api-football-client mints for API-Football's
 * bookmakers (see that package's bookmakerKeyFor). Neither provider reliably returns
 * deep links for every bookmaker — when one's unavailable, the UI falls back to the
 * bookmaker's main sportsbook page so the user always has *somewhere* to click.
 *
 * Keep in sync with DEFAULT_BOOKMAKERS in apps/web/app/api/ingest/poll/route.ts for
 * the `pinnacle`.."betway" keys — narrowed to Argentina-facing books only (2026-09-07).
 * The `af:` entries are API-Football additions — originally kept to just
 * `bet365`/`1xbet` (2026-09-07): Bet365 is the actual gap-filler (not available on The
 * Odds API at all, confirmed 2026-09-02) and 1xBet has real Argentina presence;
 * API-Football's other global books (William Hill, Betfair, Marathonbet) were
 * deliberately left out to match the team's Argentina-only direction. `af:betano`/
 * `af:betsson` were added 2026-09-08 alongside DEFAULT_API_FOOTBALL_BOOKMAKERS in
 * poll-api-football-odds/route.ts — distinct keys from the unprefixed `betano_uk`/
 * `betsson` above (those are The Odds API's keys, no longer polled for soccer at all).
 */
export const BOOKMAKER_URLS: Record<string, string> = {
  pinnacle: "https://www.pinnacle.com/es/",
  betano_uk: "https://www.betano.bet.ar",
  codere_it: "https://www.codere.bet.ar",
  betsson: "https://www.betsson.bet.ar",
  betway: "https://betway.com",
  "af:bet365": "https://www.bet365.bet.ar",
  "af:1xbet": "https://1xbet.bet.ar",
  "af:betano": "https://www.betano.bet.ar",
  "af:betsson": "https://www.betsson.bet.ar",
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
  "af:betano": "Betano",
  "af:betsson": "Betsson",
};

/**
 * Returns the best available link for a leg: the API-provided deep link if it
 * exists, otherwise the bookmaker's sportsbook homepage.
 */
export function resolveBookmakerLink(deepLink?: string | null, bookmakerKey?: string): string | undefined {
  let link = deepLink;
  
  // APIs typically return global .com deep links, which are DNS-blocked by ISPs in 
  // Argentina. Rewrite them to the local regulated .bet.ar domains.
  if (link) {
    if (link.includes("bet365.com")) link = link.replace("bet365.com", "bet365.bet.ar");
    if (link.includes("1xbet.com")) link = link.replace("1xbet.com", "1xbet.bet.ar");
    if (link.includes("betano.com")) link = link.replace("betano.com", "betano.bet.ar");
    if (link.includes("betsson.com")) link = link.replace("betsson.com", "betsson.bet.ar");
    if (link.includes("codere.es") || link.includes("codere.com")) link = link.replace(/codere\.(es|com)/, "codere.bet.ar");
    
    return link;
  }
  
  if (bookmakerKey) return BOOKMAKER_URLS[bookmakerKey.toLowerCase()];
  return undefined;
}

/** Returns a display-friendly bookmaker name. */
export function bookmakerDisplayName(key: string): string {
  return BOOKMAKER_NAMES[key.toLowerCase()] ?? key;
}
