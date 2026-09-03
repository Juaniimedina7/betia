import type { BookmakerOdds } from "@bet/odds-api-client";

interface MarketInfo {
  label: string;
  outcomes: Record<string, string>;
}

export interface GetOddsOutput {
  bookmakerOdds: BookmakerOdds;
  source: "redis" | "db-cache" | "no-odds";
  matchup?: { homeTeam?: string; awayTeam?: string; startTime?: string };
  marketCatalog: Record<string, MarketInfo>;
}

const outcomeKey = (name: string, point: number | undefined) => `${name}|${point ?? ""}`;

/** Cuotas de un partido puntual (get_odds) — static snapshot, not live like
 * live-odds-table.tsx, since a chat message never updates after it's rendered. */
export function OddsCard({ output }: { output: GetOddsOutput }) {
  const bookmakers = Object.keys(output.bookmakerOdds).sort((a, b) =>
    a === "pinnacle" ? -1 : b === "pinnacle" ? 1 : a.localeCompare(b),
  );

  if (output.source === "no-odds" || bookmakers.length === 0) {
    return (
      <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        {output.matchup?.homeTeam && output.matchup?.awayTeam
          ? `Todavía no hay cuotas cargadas para ${output.matchup.homeTeam} vs ${output.matchup.awayTeam}.`
          : "Todavía no hay cuotas cargadas para ese partido."}
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[var(--line)] px-5 py-3">
        <span className="eyebrow">
          {output.matchup?.homeTeam && output.matchup?.awayTeam
            ? `${output.matchup.homeTeam} vs ${output.matchup.awayTeam}`
            : "Cuotas del partido"}
        </span>
      </div>
      {Object.entries(output.marketCatalog).map(([marketId, market]) => {
        const keys = new Set<string>();
        for (const book of Object.values(output.bookmakerOdds)) {
          for (const outcome of book?.markets?.[marketId]?.outcomes ?? []) {
            keys.add(outcomeKey(outcome.name, outcome.point));
          }
        }
        if (keys.size === 0) return null;

        const bestByKey = new Map<string, number>();
        for (const key of keys) {
          let best = 0;
          for (const bm of bookmakers) {
            const outcome = output.bookmakerOdds[bm]?.markets?.[marketId]?.outcomes.find(
              (o) => outcomeKey(o.name, o.point) === key,
            );
            if (outcome && outcome.price > best) best = outcome.price;
          }
          if (best > 0) bestByKey.set(key, best);
        }

        return (
          <div key={marketId} className="border-b border-[var(--line)] last:border-b-0">
            <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
              {market.label}
            </p>
            <div className="overflow-x-auto px-5 py-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">
                    <th />
                    {bookmakers.map((bm) => (
                      <th key={bm} className="px-3 pb-1 text-center font-semibold capitalize">
                        {bm}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {[...keys].map((key) => (
                    <tr key={key}>
                      <td className="py-2 pr-3 font-medium text-[var(--color-ink)] whitespace-nowrap">
                        {market.outcomes[key.split("|")[0]] ?? key.split("|")[0]}
                      </td>
                      {bookmakers.map((bm) => {
                        const outcome = output.bookmakerOdds[bm]?.markets?.[marketId]?.outcomes.find(
                          (o) => outcomeKey(o.name, o.point) === key,
                        );
                        const isBest = outcome && bestByKey.get(key) === outcome.price;
                        return (
                          <td key={bm} className="px-3 py-2 text-center tnum whitespace-nowrap">
                            {outcome ? (
                              <span style={{ color: isBest ? "var(--color-edge)" : "var(--color-ink)" }}>
                                {isBest && "▲ "}
                                {outcome.price.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-[var(--color-ink-faint)]">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
