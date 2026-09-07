/**
 * Human-readable Spanish labels for The Odds API's small, fixed market-key enum, plus
 * the API-Football market keys worth a proper label (see
 * packages/api-football-client's slugifyMarketName — anything not listed here just
 * falls back to its raw slug via marketLabel's `?? marketKey` below, since
 * API-Football can return dozens of niche bet types we don't curate by hand).
 */
const MARKET_LABELS: Record<string, string> = {
  h2h: "Ganador del partido",
  spreads: "Hándicap",
  totals: "Más/menos",
  // API-Football-only market keys (packages/api-football-client normalizes bet names
  // to these slugs; "Match Winner" is special-cased to "h2h" above instead).
  asian_handicap: "Hándicap asiático",
  goals_over_under: "Más/menos goles",
  both_teams_score: "Ambos anotan",
  double_chance: "Doble oportunidad",
  exact_score: "Resultado exacto",
  odd_even: "Par/impar",
};

export function marketLabel(marketKey: string): string {
  return MARKET_LABELS[marketKey] ?? marketKey;
}

/**
 * For h2h, the outcome name already IS the display label (a team name, or "Draw") —
 * no lookup needed, unlike OddsPapi where outcomes were opaque ids ("1"/"2"/"X").
 * For spreads/totals, appends the line the outcome refers to.
 */
export function outcomeLabel(outcomeName: string, point: number | undefined): string {
  if (outcomeName === "Over") return point !== undefined ? `Más de ${point}` : "Más de";
  if (outcomeName === "Under") return point !== undefined ? `Menos de ${point}` : "Menos de";
  if (outcomeName === "Draw") return "Empate";
  if (point === undefined) return outcomeName;
  return `${outcomeName} (${point > 0 ? "+" : ""}${point})`;
}
