/**
 * Maps a The Odds API sport_key (DEFAULT_WATCHED_SPORT_KEYS in watched-sport-keys.ts)
 * to the numeric API-Football league id covering the same competition. Separate from
 * packages/mcp-tools/src/league-map.ts's LEAGUE_MAP (that one maps to Highlightly for
 * stats) — this is odds-only and does not touch the stats pipeline.
 *
 * API-Football is soccer-only, so NBA/NFL/tennis sport_keys have no entry here and
 * keep getting their odds solely from The Odds API — see
 * apps/web/app/api/ingest/poll-api-football-odds/route.ts, which skips any fixture
 * whose league id isn't in this map.
 *
 * All 13 ids verified live 2026-09-07 against GET /leagues?id=<id>.
 */
export const API_FOOTBALL_LEAGUE_IDS: Record<string, number> = {
  // Europe — top flights
  soccer_epl: 39, // England: Premier League
  soccer_spain_la_liga: 140, // Spain: LaLiga
  soccer_italy_serie_a: 135, // Italy: Serie A
  soccer_germany_bundesliga: 78, // Germany: Bundesliga
  soccer_france_ligue_one: 61, // France: Ligue 1
  // Europe — continental cups
  soccer_uefa_champs_league: 2, // UEFA Champions League
  soccer_uefa_europa_league: 3, // UEFA Europa League
  soccer_uefa_europa_conference_league: 848, // UEFA Conference League
  // South America — continental cups
  soccer_conmebol_copa_libertadores: 13, // Copa Libertadores
  soccer_conmebol_copa_sudamericana: 11, // Copa Sudamericana
  // Latin America — top flights
  soccer_argentina_primera_division: 128, // Argentina: Liga Profesional
  soccer_brazil_campeonato: 71, // Brazil: Brasileiro Serie A
  soccer_mexico_ligamx: 262, // Mexico: Liga MX
};

/** Reverse lookup: API-Football league id -> our sport_key. */
const REVERSE_MAP: Map<number, string> = new Map(
  Object.entries(API_FOOTBALL_LEAGUE_IDS).map(([sportKey, leagueId]) => [leagueId, sportKey]),
);

export function sportKeyForApiFootballLeague(leagueId: number): string | undefined {
  return REVERSE_MAP.get(leagueId);
}
