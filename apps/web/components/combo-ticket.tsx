export interface TicketLeg {
  selection: string;
  detail?: string;
  price: number;
  edgePct?: number;
  /** Real Poisson statistical probability (0-1) of this specific outcome, when the
   * sport/market is covered by the stats model — distinct from edgePct (market-implied). */
  statisticalProbability?: number;
  /** Deep link pointing directly to the event/market on the bookmaker's site. */
  deepLink?: string;
  /** Present only when this leg came straight from a live build_combo result with every
   * field save_bet_slip needs — absent for legs re-derived from an already-saved bet
   * slip. Used exclusively to power the "Aceptar apuesta" button. */
  raw?: {
    fixtureId: string;
    sportKey: string;
    homeTeam?: string;
    awayTeam?: string;
    startTime: string;
    marketId: string;
    outcomeName: string;
    point?: number;
    selectionLabel: string;
    bookmaker: string;
    priceDecimal: number;
    fairPriceDecimal?: number;
    edgePct?: number;
  };
}

/**
 * The BETIA signature object: a betting slip rendered as a premium card.
 * Reused on the hero, in the agent chat, and for saved bets so the app
 * has one consistent, recognizable artifact.
 */
export function ComboTicket({
  legs,
  multiplier,
  avgEdge,
  avgStatisticalProbability,
  label = "Ticket BETIA",
  note,
  className = "",
}: {
  legs: TicketLeg[];
  multiplier: number;
  avgEdge?: number;
  /** Average real statistical (Poisson) probability across legs that have one — kept
   * visually separate from avgEdge, never averaged together (market vs. statistical
   * probability are two distinct numbers, see parlay-agent.ts's system prompt). */
  avgStatisticalProbability?: number;
  label?: string;
  note?: string;
  className?: string;
}) {
  return (
    <div
      className={`card relative overflow-hidden p-0 ${className}`}
      style={{ borderRadius: "var(--radius-2xl)" }}
    >
      {/* perforated top edge — the bet-slip tell */}
      <div
        aria-hidden
        className="h-3 w-full"
        style={{
          background:
            "radial-gradient(circle at 8px 0, transparent 0 6px, var(--color-pitch-850) 6px) repeat-x",
          backgroundSize: "16px 12px",
        }}
      />

      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <div className="flex items-center gap-2">
          <span
            className="font-display text-sm font-extrabold tracking-tight"
            style={{ letterSpacing: "0.02em" }}
          >
            BET<span style={{ color: "var(--color-edge)" }}>IA</span>
          </span>
          <span className="eyebrow">{label}</span>
        </div>
        <span className="chip chip-gold tnum">{legs.length} patas</span>
      </div>

      <ul className="divide-y divide-[var(--line)]">
        {legs.map((leg, i) => (
          <li key={i} className="flex items-center gap-3 px-5 py-3">
            <span
              className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs"
              style={{ background: "rgba(255,255,255,0.05)", color: "var(--color-ink-muted)" }}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--color-ink)]">{leg.selection}</p>
              {leg.detail && (
                <p className="truncate text-xs text-[var(--color-ink-muted)]">{leg.detail}</p>
              )}
            </div>
            {typeof leg.statisticalProbability === "number" && (
              <span
                className="chip tnum hidden sm:inline-flex"
                title="Probabilidad estadística (modelo Poisson)"
              >
                {(leg.statisticalProbability * 100).toFixed(0)}% prob.
              </span>
            )}
            {typeof leg.edgePct === "number" && leg.edgePct > 0 && (
              <span
                className="chip chip-edge tnum hidden sm:inline-flex"
                title="Edge vs. precio justo de mercado"
              >
                +{leg.edgePct.toFixed(1)}%
              </span>
            )}
            <div className="flex flex-col items-end gap-1">
              <span className="tnum w-14 text-right text-sm font-semibold text-[var(--color-gold)]">
                {leg.price.toFixed(2)}
              </span>
              {leg.deepLink && (
                <a
                  href={leg.deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-[var(--color-edge)] hover:underline"
                  title={`Apostar en ${leg.detail || "casa de apuestas"}`}
                >
                  Ir a la apuesta
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-end justify-between gap-4 border-t border-[var(--line-strong)] px-5 py-4">
        <div>
          <p className="eyebrow mb-1">Cuota combinada</p>
          <div className="flex flex-wrap gap-1.5">
            {typeof avgStatisticalProbability === "number" && (
              <span className="chip tnum" title="Probabilidad estadística promedio (modelo Poisson)">
                prob. estadística {(avgStatisticalProbability * 100).toFixed(0)}%
              </span>
            )}
            {typeof avgEdge === "number" && (
              <span className="chip chip-edge tnum" title="Edge de mercado promedio">
                edge medio +{avgEdge.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <div className="text-right leading-none">
          <span
            className="font-display font-black tnum"
            style={{ fontSize: "2.6rem", color: "var(--color-gold)", letterSpacing: "-0.03em" }}
          >
            {multiplier.toFixed(2)}x
          </span>
        </div>
      </div>

      {note && (
        <p className="border-t border-[var(--line)] px-5 py-3 text-xs text-[var(--color-ink-muted)]">
          {note}
        </p>
      )}
    </div>
  );
}
