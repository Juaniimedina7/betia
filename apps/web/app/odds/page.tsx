import Link from "next/link";
import { listSports } from "@bet/mcp-tools";
import { Reveal } from "@/components/reveal";
import { SportIcon } from "@/components/sport-icon";

export const dynamic = "force-dynamic";

export default async function OddsPage() {
  let sports: Awaited<ReturnType<typeof listSports>>["sports"] = [];
  let error: string | null = null;

  try {
    ({ sports } = await listSports({}));
  } catch (e) {
    error = e instanceof Error ? e.message : "No se pudo cargar la lista de deportes";
  }

  return (
    <div className="container-page py-14">
      <Reveal>
        <span className="eyebrow inline-flex items-center gap-2">
          <span className="live-dot" /> Cuotas en vivo
        </span>
        <h1
          className="mt-3 font-display font-extrabold leading-tight"
          style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
        >
          Elegí un deporte
        </h1>
        <p className="mt-3 max-w-xl text-[var(--color-ink-muted)]">
          Explorá los partidos y sus cuotas actualizadas. Cuando quieras armar una
          combinada, dejá que el agente busque el valor por vos.
        </p>
      </Reveal>

      {error && (
        <div className="mt-8 rounded-2xl border border-[rgba(255,92,108,0.35)] bg-[rgba(255,92,108,0.08)] p-5 text-sm text-[var(--color-ink)]">
          <p className="font-semibold text-[var(--color-danger)]">No pudimos cargar los deportes</p>
          <p className="mt-1 text-[var(--color-ink-muted)]">
            {error}. Revisá que <code className="tnum">ODDSPAPI_API_KEY</code> esté configurada.
          </p>
        </div>
      )}

      {!error && sports.length === 0 && (
        <p className="mt-8 text-[var(--color-ink-muted)]">No hay deportes disponibles por ahora.</p>
      )}

      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {sports.map((sport, i) => (
          <Reveal key={sport.sportId} delay={Math.min(i * 40, 400)}>
            <Link href={`/odds/${sport.sportId}`} className="card card-hover group flex h-full flex-col justify-between gap-6 p-5">
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--line-strong)] text-[var(--color-edge)]"
                style={{ background: "rgba(184,255,53,0.06)" }}
              >
                <SportIcon name={sport.name} />
              </span>
              <div className="flex items-end justify-between gap-2">
                <span className="font-display text-base font-semibold leading-tight">{sport.name}</span>
                <span
                  aria-hidden
                  className="translate-x-0 text-[var(--color-ink-faint)] transition-all group-hover:translate-x-1 group-hover:text-[var(--color-edge)]"
                >
                  →
                </span>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
