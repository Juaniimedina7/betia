export type EstimateMatchProbabilityOutput =
  | { available: false; reason: "tournament_not_mapped" | "insufficient_data" }
  | {
      available: true;
      statisticalProbability: { homeWinProb: number; drawProb: number; awayWinProb: number };
      expectedGoals: { home: number; away: number };
      basedOn: { homeTeam: string; awayTeam: string; homeMatchesPlayed: number; awayMatchesPlayed: number };
    };

const REASON_MESSAGES: Record<string, string> = {
  tournament_not_mapped: "Este deporte todavía no tiene modelo estadístico (solo cubrimos fútbol por ahora).",
  insufficient_data: "No hay datos históricos suficientes para estimar este partido.",
};

/** estimate_match_probability — the Poisson statistical estimate, kept visually
 * distinct from market-odds cards (no gold/edge accents) to reinforce that it's a
 * completely different number from build_combo's market-implied probability. */
export function MatchProbabilityCard({ output }: { output: EstimateMatchProbabilityOutput }) {
  if (!output.available) {
    return (
      <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        {REASON_MESSAGES[output.reason] ?? "No pude estimar la probabilidad de este partido."}
      </div>
    );
  }

  const { homeWinProb, drawProb, awayWinProb } = output.statisticalProbability;
  const pct = (n: number) => (n * 100).toFixed(0);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[var(--line)] px-5 py-3">
        <span className="eyebrow">
          {output.basedOn.homeTeam} vs {output.basedOn.awayTeam} · prob. estadística
        </span>
      </div>
      <div className="px-5 py-4">
        <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
          <div style={{ width: `${homeWinProb * 100}%`, background: "var(--color-ink)" }} />
          <div style={{ width: `${drawProb * 100}%`, background: "var(--color-ink-muted)" }} />
          <div style={{ width: `${awayWinProb * 100}%`, background: "var(--color-ink-faint)" }} />
        </div>
        <div className="mt-3 flex justify-between text-xs tnum text-[var(--color-ink-muted)]">
          <span>
            {output.basedOn.homeTeam} <span className="font-semibold text-[var(--color-ink)]">{pct(homeWinProb)}%</span>
          </span>
          <span>
            Empate <span className="font-semibold text-[var(--color-ink)]">{pct(drawProb)}%</span>
          </span>
          <span>
            {output.basedOn.awayTeam} <span className="font-semibold text-[var(--color-ink)]">{pct(awayWinProb)}%</span>
          </span>
        </div>
      </div>
      <p className="border-t border-[var(--line)] px-5 py-2.5 text-xs text-[var(--color-ink-muted)]">
        Goles esperados: {output.expectedGoals.home.toFixed(1)} - {output.expectedGoals.away.toFixed(1)} · basado en{" "}
        {output.basedOn.homeMatchesPlayed} partidos de local y {output.basedOn.awayMatchesPlayed} de visitante.
      </p>
    </div>
  );
}
