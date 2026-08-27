"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookmakerOdds } from "@bet/oddspapi-client";

interface MarketInfo {
  label: string;
  outcomes: Record<string, string>;
}

interface Row {
  key: string;
  bookmaker: string;
  marketId: string;
  outcomeId: string;
  playerIdx: string;
  price: number | null;
}

interface MarketGroup {
  marketId: string;
  label: string;
  rows: Row[];
}

// Each supported sport's main "who wins" market always floats to the top of the board.
const PRIORITY_MARKET_IDS = ["101", "111", "121", "261"];

export function LiveOddsTable({
  fixtureId,
  initialOdds,
  marketCatalog = {},
}: {
  fixtureId: string;
  initialOdds: BookmakerOdds;
  marketCatalog?: Record<string, MarketInfo>;
}) {
  const [odds, setOdds] = useState<BookmakerOdds>(initialOdds);
  const [connected, setConnected] = useState(false);

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

  const { groups, bestByOutcome, totalRows } = useMemo(() => {
    const rows: Row[] = [];
    const bestByOutcome = new Map<string, number>();
    for (const bookmaker of Object.keys(odds)) {
      for (const [marketId, market] of Object.entries(odds[bookmaker]?.markets ?? {})) {
        for (const [outcomeId, outcome] of Object.entries(market.outcomes)) {
          for (const [playerIdx, player] of Object.entries(outcome.players)) {
            const price = player.active === false ? null : player.price;
            const outKey = `${marketId}-${outcomeId}-${playerIdx}`;
            if (price !== null) {
              bestByOutcome.set(outKey, Math.max(bestByOutcome.get(outKey) ?? 0, price));
            }
            rows.push({ key: `${bookmaker}-${outKey}`, bookmaker, marketId, outcomeId, playerIdx, price });
          }
        }
      }
    }

    const byMarket = new Map<string, Row[]>();
    for (const row of rows) {
      const list = byMarket.get(row.marketId);
      if (list) list.push(row);
      else byMarket.set(row.marketId, [row]);
    }

    const groups: MarketGroup[] = [...byMarket.entries()]
      .map(([marketId, marketRows]) => ({
        marketId,
        label: marketCatalog[marketId]?.label ?? `Mercado ${marketId}`,
        rows: marketRows,
      }))
      .sort((a, b) => {
        const ai = PRIORITY_MARKET_IDS.indexOf(a.marketId);
        const bi = PRIORITY_MARKET_IDS.indexOf(b.marketId);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        return a.label.localeCompare(b.label);
      });

    return { groups, bestByOutcome, totalRows: rows.length };
  }, [odds, marketCatalog]);

  const bookmakerCount = Object.keys(odds).length;

  const outcomeLabel = (marketId: string, outcomeId: string, playerIdx: string) => {
    const label = marketCatalog[marketId]?.outcomes[outcomeId] ?? outcomeId;
    return playerIdx === "0" ? label : `${label} (${playerIdx})`;
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
        <span className="chip">{bookmakerCount} casas</span>
      </div>

      {totalRows === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[var(--color-ink-muted)]">
          Todavía no hay cuotas cacheadas para este partido.
        </p>
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {groups.map((group) => (
            <div key={group.marketId} className="overflow-x-auto">
              <p className="px-5 pt-4 pb-2 text-sm font-semibold">{group.label}</p>
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">
                    <th className="px-5 py-2 font-medium">Casa</th>
                    <th className="px-3 py-2 font-medium">Selección</th>
                    <th className="px-5 py-2 text-right font-medium">Cuota</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => {
                    const outKey = `${row.marketId}-${row.outcomeId}-${row.playerIdx}`;
                    const isBest = row.price !== null && bestByOutcome.get(outKey) === row.price;
                    return (
                      <tr key={row.key} className="border-t border-[var(--line)] transition-colors hover:bg-white/[0.02]">
                        <td className="px-5 py-2 font-medium">{row.bookmaker}</td>
                        <td className="px-3 py-2 text-[var(--color-ink-muted)]">
                          {outcomeLabel(row.marketId, row.outcomeId, row.playerIdx)}
                        </td>
                        <td className="px-5 py-2 text-right">
                          {row.price === null ? (
                            <span className="text-[var(--color-ink-faint)]">—</span>
                          ) : (
                            <span
                              className="tnum inline-flex items-center gap-1.5 font-semibold"
                              style={{ color: isBest ? "var(--color-edge)" : "var(--color-ink)" }}
                            >
                              {isBest && <span aria-hidden className="text-[10px]">▲</span>}
                              {row.price.toFixed(2)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <p className="border-t border-[var(--line)] px-5 py-2.5 text-xs text-[var(--color-ink-muted)]">
        <span style={{ color: "var(--color-edge)" }}>▲</span> mejor precio disponible por selección. La cuota es lo
        que te paga esa casa por cada unidad apostada si acertás esa selección.
      </p>
    </div>
  );
}
