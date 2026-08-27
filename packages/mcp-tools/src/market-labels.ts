/**
 * Human-readable Spanish labels for OddsPapi's market/outcome catalog. Covers the
 * market types that actually get bet on in practice; anything not in the dictionary
 * falls back to the raw English marketName from the catalog (still far more useful
 * than a bare numeric marketId).
 */

const fmtHandicap = (h: number) => (h > 0 ? `+${h}` : String(h));

const MARKET_TYPE_LABELS: Record<string, string | ((handicap: number) => string)> = {
  "1x2": "Ganador del partido",
  moneyline: "Ganador (sin empate)",
  spreads: (h) => `Hándicap (${fmtHandicap(h)})`,
  "spreads-european": (h) => `Hándicap europeo (${fmtHandicap(h)})`,
  "spreads-games": (h) => `Hándicap de games (${fmtHandicap(h)})`,
  "spread-corners": (h) => `Hándicap de córners (${fmtHandicap(h)})`,
  "spread-bookings": (h) => `Hándicap de tarjetas (${fmtHandicap(h)})`,
  totals: (h) => `Más/menos de ${h}`,
  "totals-corners": (h) => `Más/menos de ${h} córners`,
  "totals-bookings": (h) => `Más/menos de ${h} tarjetas`,
  "totals-games": (h) => `Más/menos de ${h} games`,
  "totals-aces": (h) => `Más/menos de ${h} aces`,
  "totals-tiebreaks": (h) => `Más/menos de ${h} tiebreaks`,
  "teamtotals-team1": (h) => `Más/menos equipo 1 (${h})`,
  "teamtotals-team2": (h) => `Más/menos equipo 2 (${h})`,
  "teamtotals-corners-team1": (h) => `Más/menos córners equipo 1 (${h})`,
  "teamtotals-corners-team2": (h) => `Más/menos córners equipo 2 (${h})`,
  "teamtotals-bookings-team1": (h) => `Más/menos tarjetas equipo 1 (${h})`,
  "teamtotals-bookings-team2": (h) => `Más/menos tarjetas equipo 2 (${h})`,
  "teamtotals-games-team1": (h) => `Más/menos games equipo 1 (${h})`,
  "teamtotals-games-team2": (h) => `Más/menos games equipo 2 (${h})`,
  bothteamsscore: "Ambos equipos anotan",
  doublechance: "Doble oportunidad",
  drawnobet: "Empate anula apuesta",
  oddeven: "Total par/impar",
  "oddeven-games": "Total de games par/impar",
  "oddeven-sets": "Total de sets par/impar",
  correctscore: "Resultado exacto",
  exactscore: "Resultado exacto",
  "exactscore-team1": "Resultado exacto — equipo 1",
  "exactscore-team2": "Resultado exacto — equipo 2",
  "toscore-team1": "¿Anota el equipo 1?",
  "toscore-team2": "¿Anota el equipo 2?",
  "cleansheet-team1": "Equipo 1 no recibe goles",
  "cleansheet-team2": "Equipo 2 no recibe goles",
  "wintonil-team1": "Equipo 1 gana sin recibir goles",
  "wintonil-team2": "Equipo 2 gana sin recibir goles",
  winningmargin: "Margen de victoria",
  "winaset-team1": "Jugador/equipo 1 gana un set",
  "winaset-team2": "Jugador/equipo 2 gana un set",
  exactsets: "Resultado exacto en sets",
  "exactsets-team1": "Sets exactos — jugador 1",
  "exactsets-team2": "Sets exactos — jugador 2",
  tiebreak: "¿Hay tiebreak?",
  anysettonil: "Algún set 6-0",
  bothwinset: "Ambos ganan un set",
};

const WORD_TRANSLATIONS: Array<[RegExp, string]> = [
  [/\bPoints\b/g, "Puntos"],
  [/\bRebounds\b/g, "Rebotes"],
  [/\bAssists\b/g, "Asistencias"],
  [/\bSteals\b/g, "Robos"],
  [/\bBlocks\b/g, "Tapones"],
  [/\bTurnovers\b/g, "Pérdidas"],
  [/\b3-?Pointers?\b/g, "Triples"],
  [/\bDouble-Double\b/gi, "Doble-doble"],
  [/\bTriple-Double\b/gi, "Triple-doble"],
  [/\bOver Under\b/g, "Más/menos"],
  [/\bTeam (\d)\b/g, "Equipo $1"],
];

function translateMarketName(marketName: string): string {
  let out = marketName;
  for (const [pattern, replacement] of WORD_TRANSLATIONS) out = out.replace(pattern, replacement);
  return out;
}

export function marketLabel(marketType: string, marketName: string, handicap: number): string {
  const entry = MARKET_TYPE_LABELS[marketType];
  if (typeof entry === "function") return entry(handicap);
  if (typeof entry === "string") return entry;
  return translateMarketName(marketName);
}

export function outcomeLabel(
  outcomeName: string,
  participant1Name: string | undefined,
  participant2Name: string | undefined,
): string {
  if (outcomeName === "1" && participant1Name) return participant1Name;
  if (outcomeName === "2" && participant2Name) return participant2Name;
  if (outcomeName === "X") return "Empate";
  if (outcomeName === "Yes") return "Sí";
  if (outcomeName === "No") return "No";
  if (outcomeName === "Over") return "Más de";
  if (outcomeName === "Under") return "Menos de";
  return translateMarketName(outcomeName);
}
