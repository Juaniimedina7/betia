export interface ExternalLeagueRef {
  leagueId: string;
  season: string;
}

/**
 * Maps a The Odds API sport_key (the DEFAULT_WATCHED_SPORT_KEYS watched by
 * apps/web/app/api/ingest/poll/route.ts) to the Highlightly {leagueId, season} that
 * covers the same competition. Shared between the stats-ingestion route
 * (apps/web/app/api/ingest/poll-stats/route.ts) and the get_team_stats /
 * get_head_to_head / estimate_match_probability tools below, since both need to
 * resolve a sport_key the same way.
 *
 * These are the same 16 Highlightly {leagueId, season} values verified live on
 * 2026-08-31 (see CLAUDE.md's "Highlightly quota" section) — only the left-hand keys
 * changed, rekeyed from OddsPapi's numeric tournamentIds to The Odds API's sport_key
 * strings during the 2026-09-02 provider migration. Highlightly itself didn't change,
 * so the right-hand values were not re-verified. Two exceptions, both noted inline:
 * Copa America (biennial, no 2025/2026 edition yet) and Uruguay was already dropped
 * from the watchlist entirely (see watched-sport-keys.ts — not on The Odds API), so
 * its old split Apertura/Clausura mapping note no longer applies here.
 */
export const LEAGUE_MAP: Record<string, ExternalLeagueRef> = {
  // Europe — top flights
  "soccer_epl": { leagueId: "33973", season: "2026" }, // England: Premier League
  "soccer_spain_la_liga": { leagueId: "119924", season: "2026" }, // Spain: LaLiga
  "soccer_italy_serie_a": { leagueId: "115669", season: "2026" }, // Italy: Serie A
  "soccer_germany_bundesliga": { leagueId: "67162", season: "2026" }, // Germany: Bundesliga
  "soccer_france_ligue_one": { leagueId: "52695", season: "2026" }, // France: Ligue 1
  "soccer_portugal_primeira_liga": { leagueId: "80778", season: "2026" }, // Portugal: Primeira Liga
  // Europe — continental cups
  "soccer_uefa_champs_league": { leagueId: "2486", season: "2026" }, // UEFA Champions League
  "soccer_uefa_europa_league": { leagueId: "3337", season: "2026" }, // UEFA Europa League
  "soccer_uefa_europa_conference_league": { leagueId: "722432", season: "2026" }, // UEFA Conference League
  // South America — continental cups
  "soccer_conmebol_copa_libertadores": { leagueId: "11847", season: "2026" }, // Copa Libertadores
  "soccer_conmebol_copa_sudamericana": { leagueId: "10145", season: "2026" }, // Copa Sudamericana
  // Copa America is biennial (not an annual competition) — Highlightly's most recent
  // completed edition is season 2024; there was no 2025/2026 edition as of 2026-08-31.
  // Revisit this one specifically when the next edition is announced, don't just bump
  // the year like the annual leagues above.
  "soccer_conmebol_copa_america": { leagueId: "8443", season: "2024" }, // Copa America
  // Latin America — top flights
  "soccer_argentina_primera_division": { leagueId: "109712", season: "2026" }, // Argentina: Liga Profesional
  "soccer_brazil_campeonato": { leagueId: "61205", season: "2026" }, // Brazil: Brasileiro Serie A
  "soccer_chile_campeonato": { leagueId: "226299", season: "2026" }, // Chile: Primera Division
  "soccer_mexico_ligamx": { leagueId: "223746", season: "2026" }, // Mexico: Liga MX
};

export function resolveLeagueRef(sportKey: string): ExternalLeagueRef | undefined {
  return LEAGUE_MAP[sportKey];
}
