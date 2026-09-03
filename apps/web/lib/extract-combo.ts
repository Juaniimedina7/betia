import type { TicketLeg } from "@/components/combo-ticket";
import { getToolOutput } from "@/lib/agent-tool-output";

interface RawLeg {
  fixtureId?: string;
  sportKey?: string;
  homeTeam?: string;
  awayTeam?: string;
  startTime?: string;
  marketId?: string;
  outcomeName?: string;
  point?: number;
  selectionLabel?: string;
  bookmaker?: string;
  priceDecimal?: number;
  fairPriceDecimal?: number;
  edgePct?: number;
  statisticalProbability?: number;
}

/**
 * A leg only carries persistable `raw` data when every field save_bet_slip requires is
 * present — true for a live build_combo result, false for anything hand-trimmed.
 */
function toRaw(l: RawLeg): TicketLeg["raw"] {
  if (
    !l.fixtureId ||
    !l.sportKey ||
    !l.startTime ||
    !l.marketId ||
    !l.outcomeName ||
    !l.selectionLabel ||
    !l.bookmaker ||
    typeof l.priceDecimal !== "number"
  ) {
    return undefined;
  }
  return {
    fixtureId: l.fixtureId,
    sportKey: l.sportKey,
    homeTeam: l.homeTeam,
    awayTeam: l.awayTeam,
    startTime: l.startTime,
    marketId: l.marketId,
    outcomeName: l.outcomeName,
    point: l.point,
    selectionLabel: l.selectionLabel,
    bookmaker: l.bookmaker,
    priceDecimal: l.priceDecimal,
    fairPriceDecimal: l.fairPriceDecimal,
    edgePct: l.edgePct,
  };
}

/**
 * Best-effort extraction of a `build_combo` tool result into ticket props.
 * Shared by the agent page and the logged-in dashboard chat: the tool output
 * arrives in a few shapes (raw object, MCP `content[0].text`, JSON string).
 */
export function extractCombo(
  part: unknown,
): { legs: TicketLeg[]; multiplier: number; avgEdge?: number; avgStatisticalProbability?: number } | null {
  try {
    const data = getToolOutput(part);
    const d = data as {
      legs?: RawLeg[];
      combinedOddsDecimal?: number;
      averageEdgePct?: number;
      averageStatisticalProbability?: number;
    };
    if (!d?.legs || !Array.isArray(d.legs) || d.legs.length === 0) return null;
    return {
      legs: d.legs.map((l) => ({
        selection: l.selectionLabel ?? "Selección",
        detail: l.bookmaker,
        price: Number(l.priceDecimal ?? 0),
        edgePct: typeof l.edgePct === "number" ? l.edgePct : undefined,
        statisticalProbability:
          typeof l.statisticalProbability === "number" ? l.statisticalProbability : undefined,
        raw: toRaw(l),
      })),
      multiplier: Number(d.combinedOddsDecimal ?? 0),
      avgEdge: typeof d.averageEdgePct === "number" ? d.averageEdgePct : undefined,
      avgStatisticalProbability:
        typeof d.averageStatisticalProbability === "number" ? d.averageStatisticalProbability : undefined,
    };
  } catch {
    return null;
  }
}
