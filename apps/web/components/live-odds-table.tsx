"use client";

import { useEffect, useState } from "react";
import type { BookmakerOdds } from "@bet/oddspapi-client";

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

  const bookmakers = Object.keys(odds);

  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">
        {connected ? "En vivo" : "Conectando..."} · {bookmakers.length} casas
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left dark:border-white/10">
              <th className="py-2 pr-4">Casa</th>
              <th className="py-2 pr-4">Mercado</th>
              <th className="py-2 pr-4">Selección</th>
              <th className="py-2 pr-4">Precio</th>
            </tr>
          </thead>
          <tbody>
            {bookmakers.flatMap((bookmaker) =>
              Object.entries(odds[bookmaker]?.markets ?? {}).flatMap(([marketId, market]) =>
                Object.entries(market.outcomes).flatMap(([outcomeId, outcome]) =>
                  Object.entries(outcome.players).map(([playerIdx, player]) => (
                    <tr
                      key={`${bookmaker}-${marketId}-${outcomeId}-${playerIdx}`}
                      className="border-b border-black/5 dark:border-white/5"
                    >
                      <td className="py-1.5 pr-4">{bookmaker}</td>
                      <td className="py-1.5 pr-4 text-gray-500">{marketId}</td>
                      <td className="py-1.5 pr-4 text-gray-500">
                        {outcomeId}/{playerIdx}
                      </td>
                      <td className="py-1.5 pr-4 font-mono">{player.active === false ? "—" : player.price}</td>
                    </tr>
                  )),
                ),
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
