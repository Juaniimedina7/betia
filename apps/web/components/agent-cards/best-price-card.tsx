interface Selection {
  selectionLabel: string;
  bookmaker: string;
  priceDecimal: number;
  fairPriceDecimal: number;
  edgePct: number;
}

export type GetBestPriceOutput = { found: false } | { found: true; selections: Selection[] };

/** get_best_price — every bookmaker's price for one exact selection, best price first. */
export function BestPriceCard({ output }: { output: GetBestPriceOutput }) {
  if (!output.found || output.selections.length === 0) {
    return (
      <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        No hay cuotas cacheadas para esa selección todavía.
      </div>
    );
  }

  const sorted = [...output.selections].sort((a, b) => b.priceDecimal - a.priceDecimal);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <span className="eyebrow">{sorted[0]!.selectionLabel}</span>
        <span className="chip tnum">{sorted.length} casas</span>
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {sorted.map((s, i) => (
          <li key={s.bookmaker} className="flex items-center justify-between gap-3 px-5 py-3">
            <span className="text-sm capitalize text-[var(--color-ink)]">{s.bookmaker}</span>
            <div className="flex items-center gap-2 tnum text-sm">
              {s.edgePct > 0 && <span className="chip chip-edge">+{s.edgePct.toFixed(1)}%</span>}
              <span
                className="font-semibold"
                style={{ color: i === 0 ? "var(--color-edge)" : "var(--color-ink)" }}
              >
                {i === 0 && "▲ "}
                {s.priceDecimal.toFixed(2)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
