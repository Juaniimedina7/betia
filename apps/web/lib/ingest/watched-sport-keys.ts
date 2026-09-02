import { getDb, sportsCache } from "@bet/db";
import { and, eq } from "drizzle-orm";

/**
 * Fixed watchlist: soccer leagues, plus the two "always-on" major team sports (NBA,
 * NFL) that — like soccer — each run as a single stable sport_key year-round. Tennis
 * is NOT here; see watchedTennisSportKeys below.
 *
 * Trimmed 2026-09-03 to make room for NBA/NFL/tennis within the same monthly budget:
 * dropped Copa America (out of season anyway, no active edition) and, to free up
 * enough headroom, the two lowest-volume domestic leagues remaining after the
 * continental cups — Portugal Primeira Liga and Chile Primera Division. The
 * continental cups (Libertadores/Sudamericana) stay per the original 2026-09-02
 * migration's decision to protect them. Redo the budget math in CLAUDE.md's "The Odds
 * API quota" section before adding any of these back.
 */
export const DEFAULT_WATCHED_SPORT_KEYS = [
  // Europe — top flights
  "soccer_epl", // England: Premier League
  "soccer_spain_la_liga", // Spain: LaLiga
  "soccer_italy_serie_a", // Italy: Serie A
  "soccer_germany_bundesliga", // Germany: Bundesliga
  "soccer_france_ligue_one", // France: Ligue 1
  // Europe — continental cups
  "soccer_uefa_champs_league", // UEFA Champions League
  "soccer_uefa_europa_league", // UEFA Europa League
  "soccer_uefa_europa_conference_league", // UEFA Conference League
  // South America — continental cups
  "soccer_conmebol_copa_libertadores", // Copa Libertadores
  "soccer_conmebol_copa_sudamericana", // Copa Sudamericana
  // Latin America — top flights
  "soccer_argentina_primera_division", // Argentina: Liga Profesional
  "soccer_brazil_campeonato", // Brazil: Brasileiro Serie A
  "soccer_mexico_ligamx", // Mexico: Liga MX
  // Other sports
  "basketball_nba", // NBA
  "americanfootball_nfl", // NFL
];

/**
 * Caps how many currently-active tennis tournaments get polled per run — a defensive
 * bound, not a precise budget calculation, since concurrent-tournament count varies
 * through the year (majors rarely overlap, but Masters/Premier-level events sometimes
 * do). 2 covers the common case (ATP + WTA of the same active major) while keeping
 * worst-case monthly cost bounded and predictable.
 */
const MAX_TENNIS_TOURNAMENTS_PER_RUN = 2;

/**
 * Reads sports_cache (refreshed earlier in the same /api/ingest/poll run, before this
 * is called) for currently-active tennis tournaments. Best-effort: a DB hiccup here
 * just means tennis is skipped for this run, not that the whole poll fails.
 */
async function watchedTennisSportKeys(): Promise<string[]> {
  try {
    const db = getDb();
    const rows = await db
      .select({ sportKey: sportsCache.sportKey })
      .from(sportsCache)
      .where(and(eq(sportsCache.group, "Tennis"), eq(sportsCache.active, true)));
    return rows.map((r) => r.sportKey).slice(0, MAX_TENNIS_TOURNAMENTS_PER_RUN);
  } catch {
    return [];
  }
}

export async function watchedSportKeys(): Promise<string[]> {
  const fromEnv = (process.env.WATCHED_SPORT_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  // An explicit override means exactly this list — skip tennis auto-discovery so the
  // override isn't silently padded with tournaments the caller didn't ask for.
  if (fromEnv.length > 0) return fromEnv;

  const tennis = await watchedTennisSportKeys();
  return [...DEFAULT_WATCHED_SPORT_KEYS, ...tennis];
}
