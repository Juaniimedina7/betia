import Link from "next/link";
import { getOdds } from "@bet/mcp-tools";
import { LiveOddsTable } from "@/components/live-odds-table";
import { Reveal } from "@/components/reveal";

export const dynamic = "force-dynamic";

export default async function FixturePage({ params }: PageProps<"/fixtures/[fixtureId]">) {
  const { fixtureId } = await params;

  let bookmakerOdds: Awaited<ReturnType<typeof getOdds>>["bookmakerOdds"] = {};
  let source: Awaited<ReturnType<typeof getOdds>>["source"] | null = null;
  let cachedAt: string | undefined;
  let matchup: Awaited<ReturnType<typeof getOdds>>["matchup"];
  let error: string | null = null;

  try {
    ({ bookmakerOdds, source, cachedAt, matchup } = await getOdds({ fixtureId }));
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

      {!error && source === "db-cache" && (
        <p className="mt-4 rounded-2xl border border-[var(--line-strong)] bg-[rgba(255,255,255,0.03)] p-4 text-sm text-[var(--color-ink-muted)]">
          Mostrando las últimas cuotas guardadas{cachedAt ? ` (${new Date(cachedAt).toLocaleString("es-AR")})` : ""}{" "}
          — no pudimos conectar con OddsPapi ahora mismo.
        </p>
      )}

      {!error && source === "no-odds" && (
        <p className="mt-4 rounded-2xl border border-[var(--line-strong)] bg-[rgba(255,255,255,0.03)] p-4 text-sm text-[var(--color-ink-muted)]">
          Todavía no tenemos cuotas guardadas para este partido y no pudimos conectar con
          OddsPapi ahora mismo — probá de nuevo en un rato.
        </p>
      )}

      <div className="mt-8">
        {error ? (
          <p className="text-[var(--color-danger)]">{error}</p>
        ) : (
          <LiveOddsTable fixtureId={fixtureId} initialOdds={bookmakerOdds} />
        )}
      </div>
    </div>
  );
}
