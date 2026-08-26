import Link from "next/link";
import { listFixtures } from "@bet/mcp-tools";
import { Reveal } from "@/components/reveal";

export const dynamic = "force-dynamic";

export default async function SportOddsPage({ params }: PageProps<"/odds/[sportId]">) {
  const { sportId } = await params;
  let fixtures: Awaited<ReturnType<typeof listFixtures>>["fixtures"] = [];
  let error: string | null = null;

  try {
    ({ fixtures } = await listFixtures({ sportId }));
  } catch (e) {
    error = e instanceof Error ? e.message : "No se pudieron cargar los partidos";
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
        <h1
          className="mt-3 font-display font-extrabold leading-tight"
          style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", letterSpacing: "-0.03em" }}
        >
          Próximos partidos
        </h1>
      </Reveal>

      {error && <p className="mt-6 text-[var(--color-danger)]">{error}</p>}
      {!error && fixtures.length === 0 && (
        <p className="mt-6 text-[var(--color-ink-muted)]">No hay partidos próximos para este deporte.</p>
      )}

      <div className="mt-8 flex flex-col gap-3">
        {fixtures.map((fixture, i) => (
          <Reveal key={fixture.fixtureId} delay={Math.min(i * 35, 350)}>
            <Link
              href={`/fixtures/${fixture.fixtureId}`}
              className="card card-hover group flex items-center justify-between gap-4 px-5 py-4"
            >
              <div className="flex items-center gap-4">
                <span className="hidden h-9 w-9 items-center justify-center rounded-lg border border-[var(--line-strong)] text-xs text-[var(--color-ink-muted)] sm:flex tnum">
                  VS
                </span>
                <div>
                  <p className="font-medium leading-tight">
                    {fixture.participant1Name ?? fixture.participant1Id}
                    <span className="mx-2 text-[var(--color-ink-faint)]">vs</span>
                    {fixture.participant2Name ?? fixture.participant2Id}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-ink-muted)] tnum">
                    {new Date(fixture.startTime).toLocaleString("es-AR", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
              <span
                aria-hidden
                className="text-[var(--color-ink-faint)] transition-all group-hover:translate-x-1 group-hover:text-[var(--color-edge)]"
              >
                Ver cuotas →
              </span>
            </Link>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
