export interface ExternalLeagueRef {
  leagueId: string;
  season: string;
}

/**
 * Maps an OddsPapi tournamentId (the DEFAULT_WATCHED_TOURNAMENT_IDS watched by
 * apps/web/app/api/ingest/poll/route.ts) to the Highlightly {leagueId, season} that
 * covers the same competition. Shared between the stats-ingestion route
 * (apps/web/app/api/ingest/poll-stats/route.ts) and the get_team_stats /
 * get_head_to_head / estimate_match_probability tools below, since both need to
 * resolve a tournamentId the same way.
 *
 * Verified 2026-08-31 against live `GET /leagues?limit=100&offset=N` calls (see
 * CLAUDE.md's "Highlightly quota" section) — all 20 watched tournaments resolved,
 * every annual competition has a full 2026 season. Two exceptions, both noted inline:
 * Copa America (biennial, no 2025/2026 edition yet) and Uruguay (played as split
 * Apertura/Clausura tournaments rather than one continuous league). Re-verify at each
 * season boundary — a stale `season` value silently returns empty/wrong stats rather
 * than erroring.
 */
export const LEAGUE_MAP: Record<string, ExternalLeagueRef> = {
  // Europe — top flights
  "17": { leagueId: "33973", season: "2026" }, // England: Premier League
  "8": { leagueId: "119924", season: "2026" }, // Spain: LaLiga
  "23": { leagueId: "115669", season: "2026" }, // Italy: Serie A
  "35": { leagueId: "67162", season: "2026" }, // Germany: Bundesliga
  "34": { leagueId: "52695", season: "2026" }, // France: Ligue 1
  "238": { leagueId: "80778", season: "2026" }, // Portugal: Liga Portugal (Primeira Liga)
  "37": { leagueId: "75672", season: "2026" }, // Netherlands: Eredivisie
  "38": { leagueId: "123328", season: "2026" }, // Belgium: Pro League (Jupiler Pro League)
  // Europe — continental cups
  "7": { leagueId: "2486", season: "2026" }, // UEFA Champions League
  "679": { leagueId: "3337", season: "2026" }, // UEFA Europa League
  "34480": { leagueId: "722432", season: "2026" }, // UEFA Conference League (Europa Conference League)
  // South America — continental cups
  "384": { leagueId: "11847", season: "2026" }, // Copa Libertadores (Highlightly: "CONMEBOL Libertadores")
  "480": { leagueId: "10145", season: "2026" }, // Copa Sudamericana (Highlightly: "CONMEBOL Sudamericana")
  // Copa America is biennial (not an annual competition) — Highlightly's most recent
  // completed edition is season 2024; there was no 2025/2026 edition as of 2026-08-31.
  // Revisit this one specifically when the next edition is announced, don't just bump
  // the year like the annual leagues above.
  "133": { leagueId: "8443", season: "2024" }, // Copa America
  // Latin America — top flights
  "155": { leagueId: "109712", season: "2026" }, // Argentina: Liga Profesional
  "325": { leagueId: "61205", season: "2026" }, // Brazil: Brasileiro Serie A
  "27665": { leagueId: "226299", season: "2026" }, // Chile: Primera Division
  // Uruguay's top flight runs as two split tournaments (Apertura/Clausura) rather than
  // one continuous league table — mapped to Apertura as the primary one. Revisit if
  // this turns out to under-represent a team's actual season form.
  "278": { leagueId: "228852", season: "2026" }, // Uruguay: Primera Division (Apertura)
  "27070": { leagueId: "204173", season: "2026" }, // Colombia: Primera A
  "27464": { leagueId: "223746", season: "2026" }, // Mexico: Liga MX
};

export function resolveLeagueRef(tournamentId: string): ExternalLeagueRef | undefined {
  return LEAGUE_MAP[tournamentId];
}
