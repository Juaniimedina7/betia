/**
 * Fallback sportsbook homepages keyed by the bookmaker keys The Odds API uses.
 * The Odds API only returns deep links (`includeLinks=true`) for some bookmakers —
 * when a deep link is unavailable, the UI falls back to the bookmaker's main
 * sportsbook page so the user always has *somewhere* to click.
 *
 * Keep in sync with DEFAULT_BOOKMAKERS in apps/web/app/api/ingest/poll/route.ts.
 */
export const BOOKMAKER_URLS: Record<string, string> = {
  pinnacle: "https://www.pinnacle.com/es/",
  unibet: "https://www.unibet.com/betting/sports",
  betano_uk: "https://www.betano.co.uk/sport/football",
  codere_it: "https://www.codere.it",
  betsson: "https://www.betsson.bet.ar",
  betway: "https://www.betway.com/en/sports",
  espnbet: "https://thescore.bet/",
};

/** Display-friendly name for a bookmaker key. */
export const BOOKMAKER_NAMES: Record<string, string> = {
  pinnacle: "Pinnacle",
  unibet: "Unibet",
  betano_uk: "Betano",
  codere_it: "Codere",
  betsson: "Betsson",
  betway: "Betway",
  espnbet: "ESPN BET",
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
