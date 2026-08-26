import Link from "next/link";
import { getOdds } from "@bet/mcp-tools";
import { LiveOddsTable } from "@/components/live-odds-table";
import { Reveal } from "@/components/reveal";

export const dynamic = "force-dynamic";

export default async function FixturePage({ params }: PageProps<"/fixtures/[fixtureId]">) {
  const { fixtureId } = await params;

  let bookmakerOdds: Awaited<ReturnType<typeof getOdds>>["bookmakerOdds"] = {};
  let error: string | null = null;

  try {
    ({ bookmakerOdds } = await getOdds({ fixtureId }));
  } catch (e) {
    error = e instanceof Error ? e.message : "No se pudieron cargar las cuotas";
  }

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
        <p className="mt-2 text-sm text-[var(--color-ink-muted)] tnum">Partido {fixtureId}</p>
      </Reveal>

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
