/**
 * Top-flight soccer leagues across Europe and Latin America, plus the main
 * continental cups. Hardcoded (rather than driven by WATCHED_TOURNAMENT_IDS) so the
 * cron works without any per-environment config — verified against a live
 * GET /v4/tournaments?sportId=10 pull, ids stable per the OddsPapi catalog.
 *
 * Shared by both ingestion routes (/api/ingest/poll for odds, /api/ingest/poll-stats
 * for Highlightly team/head-to-head stats) so the watched scope never drifts between
 * the two — see CLAUDE.md's "OddsPapi quota" and "Highlightly quota" sections for the
 * budget math that drives the 20-tournament cap.
 */
export const DEFAULT_WATCHED_TOURNAMENT_IDS = [
  // Europe — top flights
  17, // England: Premier League
  8, // Spain: LaLiga
  23, // Italy: Serie A
  35, // Germany: Bundesliga
  34, // France: Ligue 1
  238, // Portugal: Liga Portugal
  37, // Netherlands: Eredivisie
  38, // Belgium: Pro League
  // Europe — continental cups
  7, // UEFA Champions League
  679, // UEFA Europa League
  34480, // UEFA Conference League
  // South America — continental cups
  384, // Copa Libertadores
  480, // Copa Sudamericana
  133, // Copa America
  // Latin America — top flights
  155, // Argentina: Liga Profesional
  325, // Brazil: Brasileiro Serie A
  27665, // Chile: Primera Division
  278, // Uruguay: Primera Division
  27070, // Colombia: Primera A
  27464, // Mexico: Liga MX
].map(String);

export function watchedTournamentIds(): string[] {
  const fromEnv = (process.env.WATCHED_TOURNAMENT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_WATCHED_TOURNAMENT_IDS;
}
