/**
 * Top-flight soccer leagues across Europe and Latin America, plus the main
 * continental cups — as The Odds API `sport_key` strings. Hardcoded (rather than
 * driven only by WATCHED_SPORT_KEYS) so the cron works without any per-environment
 * config. Verified live against GET /v4/sports (and /v4/sports?all=true for
 * currently-out-of-season competitions) on 2026-09-02.
 *
 * Two leagues that were on OddsPapi's watchlist don't exist on The Odds API at all —
 * Uruguay's Primera División and Colombia's Primera A. Not a bug, checked with
 * `all=true` too; this provider's South American coverage stops at Argentina, Brazil,
 * Chile, Mexico, and the CONMEBOL continental cups. A real, permanent coverage gap.
 *
 * Belgium's Pro League and the Dutch Eredivisie were also dropped, but for quota
 * reasons rather than coverage: The Odds API bills 1 credit per market requested per
 * call (confirmed live — NOT a flat per-call cost like OddsPapi's), so ingest cost is
 * `runs/month × leagues × markets.length`. At the free plan's 500 requests/month, 16
 * leagues × 1 market (h2h) × 1 run/day × 30 days = 480/month, leaving ~20/month of
 * headroom for manual `workflow_dispatch` runs. 18 leagues would have been 540/month —
 * over budget. Redo this math (and reconsider what to trim) before adding leagues,
 * markets, or a second daily run.
 *
 * Shared by both ingestion routes (/api/ingest/poll for odds, /api/ingest/poll-stats
 * for Highlightly team/head-to-head stats) so the watched scope never drifts between
 * the two — see CLAUDE.md's "The Odds API quota" and "Highlightly quota" sections.
 */
export const DEFAULT_WATCHED_SPORT_KEYS = [
  // Europe — top flights
  "soccer_epl", // England: Premier League
  "soccer_spain_la_liga", // Spain: LaLiga
  "soccer_italy_serie_a", // Italy: Serie A
  "soccer_germany_bundesliga", // Germany: Bundesliga
  "soccer_france_ligue_one", // France: Ligue 1
  "soccer_portugal_primeira_liga", // Portugal: Primeira Liga
  // Europe — continental cups
  "soccer_uefa_champs_league", // UEFA Champions League
  "soccer_uefa_europa_league", // UEFA Europa League
  "soccer_uefa_europa_conference_league", // UEFA Conference League
  // South America — continental cups
  "soccer_conmebol_copa_libertadores", // Copa Libertadores
  "soccer_conmebol_copa_sudamericana", // Copa Sudamericana
  "soccer_conmebol_copa_america", // Copa America (biennial — out of season most years, that's expected)
  // Latin America — top flights
  "soccer_argentina_primera_division", // Argentina: Liga Profesional
  "soccer_brazil_campeonato", // Brazil: Brasileiro Serie A
  "soccer_chile_campeonato", // Chile: Primera Division
  "soccer_mexico_ligamx", // Mexico: Liga MX
];

export function watchedSportKeys(): string[] {
  const fromEnv = (process.env.WATCHED_SPORT_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_WATCHED_SPORT_KEYS;
}
