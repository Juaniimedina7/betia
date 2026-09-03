import type { BookmakerOdds } from "@bet/odds-api-client";

export interface FixtureSummary {
  fixtureId: string;
  homeTeam?: string;
  awayTeam?: string;
  startTime: string;
  bookmakerOdds?: BookmakerOdds;
}

const TIME_FORMAT = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Best h2h price per outcome across every cached bookmaker — just enough for a quick
 * inline preview, not a full market browser (see odds-card.tsx for that). */
function bestH2hPrices(odds: BookmakerOdds | undefined): { home?: number; draw?: number; away?: number } {
  if (!odds) return {};
  let home: number | undefined;
  let draw: number | undefined;
  let away: number | undefined;
  for (const book of Object.values(odds)) {
    const outcomes = book?.markets?.h2h?.outcomes ?? [];
    for (const [i, outcome] of outcomes.entries()) {
      const slot = outcome.name === "Draw" ? "draw" : i === 0 ? "home" : "away";
      const current = slot === "home" ? home : slot === "draw" ? draw : away;
      if (current === undefined || outcome.price > current) {
        if (slot === "home") home = outcome.price;
        else if (slot === "draw") draw = outcome.price;
        else away = outcome.price;
      }
    }
  }
  return { home, draw, away };
}

/** Shared by list_fixtures and get_odds_by_tournament — both return the same
 * `{ fixtures: FixtureSummary[] }` shape. */
export function FixtureListCard({ fixtures }: { fixtures: FixtureSummary[] }) {
  if (fixtures.length === 0) {
    return (
      <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        No hay partidos cacheados para esos filtros.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <span className="eyebrow">Partidos</span>
        <span className="chip tnum">{fixtures.length}</span>
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {fixtures.map((fixture) => {
          const prices = bestH2hPrices(fixture.bookmakerOdds);
          const start = new Date(fixture.startTime);
          return (
            <li key={fixture.fixtureId} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--color-ink)]">
                  {fixture.homeTeam ?? "?"} vs {fixture.awayTeam ?? "?"}
                </p>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  {Number.isNaN(start.getTime()) ? fixture.startTime : TIME_FORMAT.format(start)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5 tnum text-xs">
                {prices.home !== undefined && <span className="chip">1: {prices.home.toFixed(2)}</span>}
                {prices.draw !== undefined && <span className="chip">X: {prices.draw.toFixed(2)}</span>}
                {prices.away !== undefined && <span className="chip">2: {prices.away.toFixed(2)}</span>}
                {prices.home === undefined && prices.draw === undefined && prices.away === undefined && (
                  <span className="text-[var(--color-ink-faint)]">sin cuotas</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
