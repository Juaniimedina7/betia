import Link from "next/link";
import { Reveal } from "@/components/reveal";
import { ComboTicket } from "@/components/combo-ticket";

const HERO_LEGS = [
  { selection: "Boca Juniors gana", detail: "River vs Boca · 1X2", price: 2.15, edgePct: 4.2 },
  { selection: "Over 2.5 goles", detail: "PSG vs Marsella · Totales", price: 1.85, edgePct: 2.1 },
  { selection: "Djokovic gana", detail: "ATP Masters · Ganador", price: 1.42, edgePct: 3.6 },
];

const STEPS = [
  {
    k: "01",
    title: "Detecta el precio justo",
    body: "Quita el margen de la casa (de-vig) usando referencias sharp como Pinnacle para estimar la probabilidad real de cada jugada.",
  },
  {
    k: "02",
    title: "Arma la combinada",
    body: "Busca la combinación que pega a tu multiplicador objetivo, rankeada por valor y sin cruzar dos patas del mismo partido.",
  },
  {
    k: "03",
    title: "Vos decidís",
    body: "Guardás el ticket, lo llevás a tu casa favorita y marcás el resultado. BETIA no coloca apuestas — te muestra dónde está el valor.",
  },
];

/**
 * The marketing landing shown to visitors without a Clerk session. Signed-in
 * users get `UserDashboard` on the same route instead.
 */
export function PublicLanding() {
  return (
    <div>
      {/* ---------- Hero ---------- */}
      <section className="container-page relative grid items-center gap-12 pb-16 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:pt-24">
        <div>
          <Reveal>
            <span className="eyebrow inline-flex items-center gap-2">
              <span className="live-dot" /> Agente de combinadas · cuotas en vivo
            </span>
          </Reveal>

          <Reveal delay={80}>
            <h1
              className="mt-5 font-display font-black leading-[0.95]"
              style={{ fontSize: "clamp(2.6rem, 6vw, 4.6rem)", letterSpacing: "-0.035em" }}
            >
              Combinadas con
              <br />
              <span style={{ color: "var(--color-edge)" }}>inteligencia</span>, no con
              <br />
              corazonadas.
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-ink-muted)]">
              BETIA escanea cuotas en vivo de decenas de casas, calcula el precio justo de
              cada jugada y arma la combinada que mejor paga por el riesgo que querés correr.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/agent" className="btn btn-primary">
                Armar mi combinada
                <span aria-hidden>→</span>
              </Link>
              <Link href="/odds" className="btn btn-ghost">
                Ver cuotas en vivo
              </Link>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <div className="mt-9 flex flex-wrap gap-x-8 gap-y-3">
              <Feature label="De-vig con referencia sharp" />
              <Feature label="0 patas correlacionadas" />
              <Feature label="Ranking por edge" />
            </div>
          </Reveal>
        </div>

        {/* Signature ticket */}
        <Reveal delay={220} className="lg:justify-self-end">
          <div className="mx-auto w-full max-w-sm">
            <ComboTicket
              legs={HERO_LEGS}
              multiplier={5.65}
              avgEdge={3.3}
              label="Ticket de ejemplo"
              note="Ejemplo ilustrativo. Las cuotas reales se actualizan en vivo y el agente arma el ticket por vos."
            />
          </div>
        </Reveal>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="container-page py-16">
        <Reveal>
          <span className="eyebrow">Cómo encuentra valor</span>
          <h2
            className="mt-3 max-w-2xl font-display font-extrabold leading-tight"
            style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)", letterSpacing: "-0.03em" }}
          >
            El valor no se adivina. Se calcula.
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.k} delay={i * 90}>
              <article className="card card-hover h-full p-6">
                <span
                  className="tnum font-display text-sm font-bold"
                  style={{ color: "var(--color-edge)" }}
                >
                  {step.k}
                </span>
                <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
                  {step.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- CTA band ---------- */}
      <section className="container-page pb-8">
        <Reveal>
          <div
            className="card relative overflow-hidden px-8 py-12 text-center"
            style={{ borderRadius: "var(--radius-2xl)" }}
          >
            <div className="shimmer-line absolute inset-x-0 top-0 h-px" aria-hidden />
            <h2
              className="mx-auto max-w-2xl font-display font-extrabold leading-tight"
              style={{ fontSize: "clamp(1.6rem, 3vw, 2.4rem)", letterSpacing: "-0.03em" }}
            >
              Decile qué multiplicador buscás. El resto lo hace BETIA.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[var(--color-ink-muted)]">
              &quot;Armame una combinada de 50x con fútbol de hoy&quot; — y listo.
            </p>
            <div className="mt-7 flex justify-center">
              <Link href="/agent" className="btn btn-primary">
                Hablar con el agente
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}

function Feature({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 13l4 4L19 7"
          stroke="var(--color-edge)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </div>
  );
}
