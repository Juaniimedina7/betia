interface Split {
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export type GetTeamStatsOutput =
  | { resolved: false; reason: "tournament_not_mapped" | "team_not_resolved" }
  | { resolved: true; source: "no-data" }
  | { resolved: true; source: "db"; teamName: string; staleAsOf: string; home: Split; away: Split };

const REASON_MESSAGES: Record<string, string> = {
  tournament_not_mapped: "Este deporte todavía no tiene modelo estadístico (solo cubrimos fútbol por ahora).",
  team_not_resolved: "No reconocí ese equipo en los datos que tenemos.",
};

function Row({ split, label }: { split: Split; label: string }) {
  const winPct = split.matchesPlayed > 0 ? (split.wins / split.matchesPlayed) * 100 : 0;
  const goalsPerMatch = split.matchesPlayed > 0 ? split.goalsFor / split.matchesPlayed : 0;
  return (
    <div className="px-5 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <span className="tnum text-xs text-[var(--color-ink-muted)]">{split.matchesPlayed} partidos</span>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="chip chip-edge tnum">{winPct.toFixed(0)}% ganados</span>
        <span className="chip tnum">
          {split.wins}G {split.draws}E {split.losses}P
        </span>
        <span className="chip tnum">
          {split.goalsFor}-{split.goalsAgainst} goles ({goalsPerMatch.toFixed(1)}/partido)
        </span>
      </div>
    </div>
  );
}

/** get_team_stats — statistical (never market) data, visually kept on a neutral
 * (non-gold/edge) accent so it doesn't read as an odds card. */
export function TeamStatsCard({ output }: { output: GetTeamStatsOutput }) {
  if (!output.resolved) {
    return (
      <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        {REASON_MESSAGES[output.reason] ?? "No pude resolver ese equipo."}
      </div>
    );
  }
  if (output.source === "no-data") {
    return (
      <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        Todavía no tenemos estadísticas cargadas para ese equipo esta temporada.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[var(--line)] px-5 py-3">
        <span className="eyebrow">{output.teamName} · temporada</span>
      </div>
      <div className="divide-y divide-[var(--line)]">
        <Row split={output.home} label="Local" />
        <Row split={output.away} label="Visitante" />
      </div>
    </div>
  );
}
