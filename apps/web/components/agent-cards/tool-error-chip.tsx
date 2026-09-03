const FRIENDLY_MESSAGES: Record<string, string> = {
  build_combo: "No pude armar la combinada. Probá de nuevo.",
  list_sports: "No pude traer los deportes. Probá de nuevo.",
  list_tournaments: "No pude traer los torneos. Probá de nuevo.",
  list_fixtures: "No pude traer los partidos. Probá de nuevo.",
  get_odds: "No pude traer las cuotas de ese partido. Probá de nuevo.",
  get_odds_by_tournament: "No pude traer las cuotas. Probá de nuevo.",
  get_best_price: "No pude buscar la mejor cuota. Probá de nuevo.",
  get_team_stats: "No pude traer las estadísticas del equipo. Probá de nuevo.",
  get_head_to_head: "No pude traer el historial entre esos equipos. Probá de nuevo.",
  estimate_match_probability: "No pude calcular la probabilidad estadística. Probá de nuevo.",
  save_bet_slip: "No pude guardar la apuesta. Probá de nuevo.",
  list_user_bet_slips: "No pude traer tus apuestas guardadas. Probá de nuevo.",
  get_user_bet_slip: "No pude traer esa apuesta. Probá de nuevo.",
  update_bet_slip_outcome: "No pude actualizar el resultado. Probá de nuevo.",
};

/**
 * The `output-error` state of any tool part — never shows `part.errorText` raw (it can
 * be technical/English, e.g. update_bet_slip_outcome's unwrapped "Bet slip not found or
 * not owned by this user"), always a fixed, safe Spanish message keyed by tool name.
 */
export function ToolErrorChip({ toolName }: { toolName: string }) {
  const message = FRIENDLY_MESSAGES[toolName] ?? "Algo falló con esa consulta. Probá de nuevo.";
  return (
    <div
      className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs"
      style={{
        borderColor: "rgba(255,92,108,0.35)",
        background: "rgba(255,92,108,0.08)",
        color: "var(--color-danger)",
      }}
    >
      <span aria-hidden>⚠</span>
      <span>{message}</span>
    </div>
  );
}
