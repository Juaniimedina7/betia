import { getDb, sportsCache } from "@bet/db";
import { and, eq } from "drizzle-orm";

/**
 * Soccer leagues this product covers — kept as its own list (2026-09-08) now that
 * soccer odds come exclusively from API-Football (see
 * apps/web/app/api/ingest/poll-api-football-odds/route.ts and CLAUDE.md's "eliminar
 * The Odds API de futbol" section). The Odds API is no longer polled for any of these
 * — this list is used only by apps/web/app/api/ingest/poll-stats/route.ts (Highlightly
 * stats, unrelated to either odds provider) to pick which leagues' standings/H2H to
 * refresh and which odds_cache sport_keys to pull candidate fixtures (team names) from.
 * Same 13 leagues as before the migration; see git history for why each one is here
 * (continental cups protected, Portugal/Chile/Copa America cut for the old Odds-API
 * quota, Uruguay/Colombia not covered by any provider at all).
 */
export const WATCHED_SOCCER_SPORT_KEYS = [
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
];

/**
 * Fixed watchlist for The Odds API odds polling (/api/ingest/poll) — the two
 * "always-on" major team sports that, like soccer used to, each run as a single
 * stable sport_key year-round. Tennis is NOT here; see watchedTennisSportKeys below.
 *
 * Soccer was removed from this list entirely on 2026-09-08 — see
 * WATCHED_SOCCER_SPORT_KEYS above and CLAUDE.md — so this cron no longer touches
 * soccer at all, drastically shrinking its monthly-quota footprint versus before.
 */
export const DEFAULT_WATCHED_SPORT_KEYS = ["basketball_nba", "americanfootball_nfl"];

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
