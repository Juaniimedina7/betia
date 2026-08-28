import type { TicketLeg } from "@/components/combo-ticket";

/**
 * Best-effort extraction of a `build_combo` tool result into ticket props.
 * Shared by the agent page and the logged-in dashboard chat: the tool output
 * arrives in a few shapes (raw object, MCP `content[0].text`, JSON string).
 */
export function extractCombo(
  part: unknown,
): { legs: TicketLeg[]; multiplier: number; avgEdge?: number } | null {
  try {
    const p = part as { output?: unknown; result?: unknown };
    let data: unknown = p.output ?? p.result;
    if (data && typeof data === "object" && "content" in data) {
      const content = (data as { content?: Array<{ text?: string }> }).content;
      const text = content?.[0]?.text;
      if (text) data = JSON.parse(text);
    }
    if (typeof data === "string") data = JSON.parse(data);
    const d = data as {
      legs?: Array<{ selectionLabel?: string; bookmaker?: string; priceDecimal?: number; edgePct?: number }>;
      combinedOddsDecimal?: number;
      averageEdgePct?: number;
    };
    if (!d?.legs || !Array.isArray(d.legs) || d.legs.length === 0) return null;
    return {
      legs: d.legs.map((l) => ({
        selection: l.selectionLabel ?? "Selección",
        detail: l.bookmaker,
        price: Number(l.priceDecimal ?? 0),
        edgePct: typeof l.edgePct === "number" ? l.edgePct : undefined,
      })),
      multiplier: Number(d.combinedOddsDecimal ?? 0),
      avgEdge: typeof d.averageEdgePct === "number" ? d.averageEdgePct : undefined,
    };
  } catch {
    return null;
  }
}
