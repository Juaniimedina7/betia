"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookmakerOdds } from "@bet/odds-api-client";

// Each supported sport's main "who wins" market always floats to the top of the board.
const PRIORITY_MARKET_IDS = ["h2h", "spreads", "totals"];

const outcomeKey = (name: string, point: number | undefined) => `${name}|${point ?? ""}`;

export function LiveOddsTable({
  fixtureId,
  initialOdds,
}: {
  fixtureId: string;
  initialOdds: BookmakerOdds;
}) {
  const [odds, setOdds] = useState<BookmakerOdds>(initialOdds);
  const [connected, setConnected] = useState(false);
  const [activeMarketId, setActiveMarketId] = useState<string | null>(null);

  useEffect(() => {
    const source = new EventSource(`/api/sse/odds?fixtureId=${encodeURIComponent(fixtureId)}`);
    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("odds", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { bookmakerOdds: BookmakerOdds | null };
      if (payload.bookmakerOdds) setOdds(payload.bookmakerOdds);
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [fixtureId]);

  const { markets, bookmakers, bestPrices, activeMarketData, totalRows } = useMemo(() => {
    const bookmakerSet = new Set<string>();
    const marketMap = new Map<string, { label: string; outcomes: Map<string, number | undefined> }>();

    // First pass: collect all bookmakers, markets, and outcomes
    for (const [bookmaker, book] of Object.entries(odds)) {
      bookmakerSet.add(bookmaker);
      for (const [marketId, market] of Object.entries(book?.markets ?? {})) {
        if (!marketMap.has(marketId)) {
          marketMap.set(marketId, { label: marketLabel(marketId), outcomes: new Map() });
        }
        const m = marketMap.get(marketId)!;
        for (const outcome of market.outcomes ?? []) {
          m.outcomes.set(outcomeKey(outcome.name, outcome.point), outcome.point);
        }
      }
    }

    const bookmakers = Array.from(bookmakerSet).sort((a, b) => {
      // Put pinnacle first if it exists
      if (a === "pinnacle") return -1;
      if (b === "pinnacle") return 1;
      return a.localeCompare(b);
    });

    const markets = Array.from(marketMap.entries())
      .map(([id, data]) => ({ id, label: data.label, outcomes: Array.from(data.outcomes.keys()) }))
      .sort((a, b) => {
        const ai = PRIORITY_MARKET_IDS.indexOf(a.id);
        const bi = PRIORITY_MARKET_IDS.indexOf(b.id);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        return a.label.localeCompare(b.label);
      });

    // Calculate best prices for the active market
    const currentMarketId = activeMarketId ?? markets[0]?.id;
    const bestPrices = new Map<string, number>();

    let activeMarketData = null;
    if (currentMarketId) {
      activeMarketData = markets.find((m) => m.id === currentMarketId);
      if (activeMarketData) {
        for (const key of activeMarketData.outcomes) {
          let best = 0;
          for (const bm of bookmakers) {
            const outcome = odds[bm]?.markets[currentMarketId]?.outcomes.find((o) => outcomeKey(o.name, o.point) === key);
            if (outcome && outcome.price > best) best = outcome.price;
          }
          if (best > 0) bestPrices.set(key, best);
        }
      }
    }

    let totalRowsCount = 0;
    for (const bm of Object.keys(odds)) {
      for (const mId of Object.keys(odds[bm]?.markets ?? {})) {
        totalRowsCount += odds[bm]?.markets[mId]?.outcomes.length ?? 0;
      }
    }

    return { markets, bookmakers, bestPrices, activeMarketData, totalRows: totalRowsCount };
  }, [odds, activeMarketId]);

  // Sync active market if it's null
  useEffect(() => {
    if (!activeMarketId && markets.length > 0) {
      setActiveMarketId(markets[0].id);
    }
  }, [markets, activeMarketId]);

  const outcomeLabel = (key: string) => {
    const [name, pointStr] = key.split("|");
    if (name === "Draw") return "Empate";
    if (!pointStr) return name;
    const point = Number(pointStr);
    return `${name} (${point > 0 ? "+" : ""}${point})`;
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <span className="flex items-center gap-2 text-sm">
          <span className="live-dot" style={connected ? undefined : { background: "var(--color-ink-faint)", animation: "none" }} />
          <span className={connected ? "text-[var(--color-live)]" : "text-[var(--color-ink-muted)]"}>
            {connected ? "En vivo" : "Conectando…"}
          </span>
        </span>
        <span className="chip">{bookmakers.length} casas</span>
      </div>

      {totalRows === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[var(--color-ink-muted)]">
          Todavía no hay cuotas cacheadas para este partido.
        </p>
      ) : (
        <>
          <div className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.01)] px-5 py-4">
            <label htmlFor="market-select" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
              Mercado
            </label>
            <div className="relative">
              <select
                id="market-select"
                value={activeMarketId ?? ""}
                onChange={(e) => setActiveMarketId(e.target.value)}
                className="w-full appearance-none rounded-xl border border-[var(--line-strong)] bg-[rgba(255,255,255,0.02)] px-4 py-2.5 pr-10 text-sm font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-muted)] focus:border-[var(--color-edge)] focus:outline-none"
              >
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)]">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </div>

          {!activeMarketData ? (
            <p className="px-5 py-10 text-center text-sm text-[var(--color-ink-muted)]">
              No se encontraron datos para este mercado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.02)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">
                    <th className="sticky left-0 z-10 bg-[var(--color-bg)] px-5 py-3 font-semibold shadow-[1px_0_0_0_var(--line)]">
                      Selección
                    </th>
                    {bookmakers.map((bm) => (
                      <th key={bm} className="px-5 py-3 font-semibold text-center whitespace-nowrap capitalize">
                        {bm}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {activeMarketData.outcomes.map((key) => (
                    <tr key={key} className="transition-colors hover:bg-white/[0.02]">
                      <td className="sticky left-0 z-10 bg-[var(--color-bg)] px-5 py-3 font-medium text-[var(--color-ink)] shadow-[1px_0_0_0_var(--line)] whitespace-nowrap">
                        {outcomeLabel(key)}
                      </td>
                      {bookmakers.map((bm) => {
                        const outcome = odds[bm]?.markets[activeMarketData!.id]?.outcomes.find(
                          (o) => outcomeKey(o.name, o.point) === key,
                        );
                        const price = outcome?.price;
                        const isBest = price !== undefined && bestPrices.get(key) === price;

                        return (
                          <td key={bm} className="px-5 py-3 text-center">
                            {price === undefined ? (
                              <span className="text-[var(--color-ink-faint)]">—</span>
                            ) : (
                              <span
                                className="tnum inline-flex items-center gap-1 font-semibold"
                                style={{ color: isBest ? "var(--color-edge)" : "var(--color-ink)" }}
                              >
                                {isBest && <span aria-hidden className="text-[10px]">▲</span>}
                                {price.toFixed(2)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="border-t border-[var(--line)] px-5 py-3 text-xs text-[var(--color-ink-muted)] leading-relaxed bg-[rgba(255,255,255,0.01)]">
        <span style={{ color: "var(--color-edge)" }}>▲</span> mejor precio disponible por selección.<br />
        Las cuotas mostradas representan el multiplicador de tu apuesta. Una cuota vacía significa que la casa no ofrece ese mercado actualmente.
      </p>
    </div>
  );
}

function marketLabel(marketId: string): string {
  const labels: Record<string, string> = { h2h: "Ganador del partido", spreads: "Hándicap", totals: "Más/menos" };
  return labels[marketId] ?? marketId;
}
