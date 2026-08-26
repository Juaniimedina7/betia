"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookmakerOdds } from "@bet/oddspapi-client";

interface Row {
  key: string;
  bookmaker: string;
  marketId: string;
  outcomeId: string;
  playerIdx: string;
  price: number | null;
}

export function LiveOddsTable({
  fixtureId,
  initialOdds,
}: {
  fixtureId: string;
  initialOdds: BookmakerOdds;
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

  const { rows, bestByOutcome } = useMemo(() => {
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
    return { rows, bestByOutcome };
  }, [odds]);

  const bookmakerCount = Object.keys(odds).length;

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

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[var(--color-ink-muted)]">
          Todavía no hay cuotas cacheadas para este partido.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">
                <th className="px-5 py-2.5 font-medium">Casa</th>
                <th className="px-3 py-2.5 font-medium">Mercado</th>
                <th className="px-3 py-2.5 font-medium">Selección</th>
                <th className="px-5 py-2.5 text-right font-medium">Precio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const outKey = `${row.marketId}-${row.outcomeId}-${row.playerIdx}`;
                const isBest = row.price !== null && bestByOutcome.get(outKey) === row.price;
                return (
                  <tr key={row.key} className="border-t border-[var(--line)] transition-colors hover:bg-white/[0.02]">
                    <td className="px-5 py-2.5 font-medium">{row.bookmaker}</td>
                    <td className="px-3 py-2.5 text-[var(--color-ink-muted)] tnum">{row.marketId}</td>
                    <td className="px-3 py-2.5 text-[var(--color-ink-muted)] tnum">
                      {row.outcomeId}/{row.playerIdx}
                    </td>
                    <td className="px-5 py-2.5 text-right">
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
      )}

      <p className="border-t border-[var(--line)] px-5 py-2.5 text-xs text-[var(--color-ink-muted)]">
        <span style={{ color: "var(--color-edge)" }}>▲</span> mejor precio disponible por selección.
      </p>
    </div>
  );
}
