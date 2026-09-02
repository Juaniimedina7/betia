/**
 * Human-readable Spanish labels for The Odds API's small, fixed market-key enum.
 * There's no queryable market catalog on this provider (unlike OddsPapi's
 * GET /v4/markets) — markets/outcomes are a handful of known keys, so a static map
 * covers the whole surface this product actually uses.
 */
const MARKET_LABELS: Record<string, string> = {
  h2h: "Ganador del partido",
  spreads: "Hándicap",
  totals: "Más/menos",
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
