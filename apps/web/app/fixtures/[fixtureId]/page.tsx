import Link from "next/link";
import { getOdds } from "@bet/mcp-tools";
import { LiveOddsTable } from "@/components/live-odds-table";
import { Reveal } from "@/components/reveal";

export const dynamic = "force-dynamic";

export default async function FixturePage({ params }: PageProps<"/fixtures/[fixtureId]">) {
  const { fixtureId } = await params;

  let bookmakerOdds: Awaited<ReturnType<typeof getOdds>>["bookmakerOdds"] = {};
  let source: Awaited<ReturnType<typeof getOdds>>["source"] | null = null;
  let matchup: Awaited<ReturnType<typeof getOdds>>["matchup"];
  let marketCatalog: Awaited<ReturnType<typeof getOdds>>["marketCatalog"] = {};
  let error: string | null = null;

  try {
    ({ bookmakerOdds, source, matchup, marketCatalog } = await getOdds({ fixtureId }));
  } catch (e) {
    error = e instanceof Error ? e.message : "No se pudieron cargar las cuotas";
  }

  const matchupLabel =
    matchup?.participant1Name && matchup?.participant2Name
      ? `${matchup.participant1Name} vs ${matchup.participant2Name}`
      : null;

  return (
    <div className="container-page py-14">
      <Link
        href="/odds"
        className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
      >
        ← Deportes
      </Link>

      <Reveal>
        <div className="mt-3 flex items-center gap-3">
          <span className="live-dot" />
          <h1
            className="font-display font-extrabold leading-tight"
            style={{ fontSize: "clamp(1.6rem, 3vw, 2.2rem)", letterSpacing: "-0.03em" }}
          >
            Board de cuotas
          </h1>
        </div>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)] tnum">
          {matchupLabel ?? `Partido ${fixtureId}`}
        </p>
      </Reveal>

      {!error && source === "no-odds" && (
        <p className="mt-4 rounded-2xl border border-[var(--line-strong)] bg-[rgba(255,255,255,0.03)] p-4 text-sm text-[var(--color-ink-muted)]">
          Todavía no hay cuotas disponibles para este partido — probá de nuevo en un rato.
        </p>
      )}

      <div className="mt-8">
        {error ? (
          <p className="text-[var(--color-danger)]">{error}</p>
        ) : (
          <LiveOddsTable fixtureId={fixtureId} initialOdds={bookmakerOdds} marketCatalog={marketCatalog} />
        )}
      </div>
    </div>
  );
}
