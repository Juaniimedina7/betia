import Link from "next/link";
import { headers } from "next/headers";
import { listFixtures, listTournaments } from "@bet/mcp-tools";
import { Reveal } from "@/components/reveal";
import { CompetitionBrowser } from "@/components/competition-browser";
import { rankTournaments, countryName } from "@/lib/popular-leagues";

export const dynamic = "force-dynamic";

export default async function SportOddsPage({
  params,
  searchParams,
}: PageProps<"/odds/[sportId]">) {
  const { sportId } = await params;
  const sp = await searchParams;
  const comp = typeof sp.comp === "string" ? sp.comp : undefined;

  // Region from Vercel's geo header; default to AR (primary audience) when absent.
  const region = ((await headers()).get("x-vercel-ip-country") ?? "AR").toUpperCase();

  // Tournaments power both the browser and the selected-competition header.
  let ranked: ReturnType<typeof rankTournaments> = [];
  let tournamentsError: string | null = null;
  try {
    const { tournaments } = await listTournaments({ sportId });
    ranked = rankTournaments(tournaments, region);
  } catch (e) {
    tournamentsError = e instanceof Error ? e.message : "No se pudieron cargar las competiciones";
  }

  const selected = comp ? ranked.find((t) => t.tournamentId === comp) : undefined;

  return (
    <div className="container-page py-14">
      <Link
        href={comp ? `/odds/${sportId}` : "/odds"}
        className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
      >
        ← {comp ? "Competiciones" : "Deportes"}
      </Link>

      {comp ? (
        <FixturesView sportId={sportId} comp={comp} title={selected?.name} country={selected?.country} />
      ) : (
        <>
          <Reveal>
            <h1
              className="mt-3 font-display font-extrabold leading-tight"
              style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", letterSpacing: "-0.03em" }}
            >
              Competiciones
            </h1>
            <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
              Buscá por liga o país. Arriba, las más populares en tu región.
            </p>
          </Reveal>

          {tournamentsError && <p className="mt-6 text-[var(--color-danger)]">{tournamentsError}</p>}
          {!tournamentsError && ranked.length === 0 && (
            <p className="mt-6 text-[var(--color-ink-muted)]">No hay competiciones disponibles.</p>
          )}
          {ranked.length > 0 && (
            <CompetitionBrowser sportId={sportId} tournaments={ranked} regionLabel={countryName(region)} />
          )}
        </>
      )}
    </div>
  );
}

async function FixturesView({
  sportId,
  comp,
  title,
  country,
}: {
  sportId: string;
  comp: string;
  title?: string;
  country?: string;
}) {
  let fixtures: Awaited<ReturnType<typeof listFixtures>>["fixtures"] = [];
  let source: Awaited<ReturnType<typeof listFixtures>>["source"] | null = null;
  let cachedAt: string | undefined;
  let error: string | null = null;

  try {
    ({ fixtures, source, cachedAt } = await listFixtures({ sportId, tournamentId: comp }));
  } catch (e) {
    error = e instanceof Error ? e.message : "No se pudieron cargar los partidos";
  }

  // Keep only this competition's fixtures — the live API filters by tournamentId,
  // but the DB-cache fallback is sport-wide, so narrow it here too.
  const shown = fixtures.filter((f) => f.tournamentId === comp);

  return (
    <>
      <Reveal>
        <h1
          className="mt-3 font-display font-extrabold leading-tight"
          style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", letterSpacing: "-0.03em" }}
        >
          {title ?? "Próximos partidos"}
        </h1>
        {country && <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{country}</p>}
      </Reveal>

      {error && <p className="mt-6 text-[var(--color-danger)]">{error}</p>}
      {!error && source === "cache" && (
        <p className="mt-6 rounded-2xl border border-[var(--line-strong)] bg-[rgba(255,255,255,0.03)] p-4 text-sm text-[var(--color-ink-muted)]">
          Mostrando los últimos partidos guardados{cachedAt ? ` (${new Date(cachedAt).toLocaleString("es-AR")})` : ""}{" "}
          — no pudimos conectar con OddsPapi ahora mismo.
        </p>
      )}
      {!error && shown.length === 0 && (
        <p className="mt-6 text-[var(--color-ink-muted)]">No hay partidos próximos para esta competición.</p>
      )}

      <div className="mt-8 flex flex-col gap-3">
        {shown.map((fixture, i) => (
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
    </>
  );
}
