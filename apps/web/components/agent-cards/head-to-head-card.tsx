export type GetHeadToHeadOutput =
  | { resolved: false; reason: "team_not_resolved" }
  | { resolved: true; source: "no-data" }
  | {
      resolved: true;
      source: "db";
      matchesPlayed: number;
      homeTeamWins: number;
      awayTeamWins: number;
      draws: number;
      lastMeetingAt: string | null;
    };

/** get_head_to_head — the tool's own output has no team names (only counts, already
 * oriented relative to the query's homeTeam/awayTeam), so the dispatcher passes them in
 * from the tool call's `input` for display. */
export function HeadToHeadCard({
  output,
  homeTeam,
  awayTeam,
}: {
  output: GetHeadToHeadOutput;
  homeTeam?: string;
  awayTeam?: string;
}) {
  if (!output.resolved) {
    return (
      <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        No reconocí alguno de esos equipos en los datos que tenemos.
      </div>
    );
  }
  if (output.source === "no-data" || output.matchesPlayed === 0) {
    return (
      <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        No tenemos historial de enfrentamientos cargado entre esos equipos.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[var(--line)] px-5 py-3">
        <span className="eyebrow">
          {homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : "Historial"} · {output.matchesPlayed} partidos
        </span>
      </div>
      <div className="flex divide-x divide-[var(--line)] text-center">
        <div className="flex-1 px-3 py-4">
          <p className="tnum font-display text-2xl font-black" style={{ color: "var(--color-edge)" }}>
            {output.homeTeamWins}
          </p>
          <p className="mt-1 truncate text-xs text-[var(--color-ink-muted)]">{homeTeam ?? "Local"}</p>
        </div>
        <div className="flex-1 px-3 py-4">
          <p className="tnum font-display text-2xl font-black text-[var(--color-ink-muted)]">{output.draws}</p>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Empates</p>
        </div>
        <div className="flex-1 px-3 py-4">
          <p className="tnum font-display text-2xl font-black" style={{ color: "var(--color-gold)" }}>
            {output.awayTeamWins}
          </p>
          <p className="mt-1 truncate text-xs text-[var(--color-ink-muted)]">{awayTeam ?? "Visitante"}</p>
        </div>
      </div>
      {output.lastMeetingAt && (
        <p className="border-t border-[var(--line)] px-5 py-2.5 text-xs text-[var(--color-ink-muted)]">
          Último enfrentamiento: {new Date(output.lastMeetingAt).toLocaleDateString("es-AR")}
        </p>
      )}
    </div>
  );
}
