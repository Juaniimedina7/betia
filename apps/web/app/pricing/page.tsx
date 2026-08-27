import { Reveal } from "@/components/reveal";
import { PlanCta } from "@/components/plan-cta";
import { PLANS, formatArs, pricePerRun } from "@/lib/plans";

export const metadata = {
  title: "Precios — BETIA",
  description: "Planes de BETIA por combinadas mensuales. Free para probar, Starter y Pro para ir en serio.",
};

export default function PricingPage() {
  return (
    <div className="container-page py-16">
      <Reveal>
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Planes</span>
          <h1
            className="mt-3 font-display font-black leading-[0.98]"
            style={{ fontSize: "clamp(2.2rem, 5vw, 3.6rem)", letterSpacing: "-0.035em" }}
          >
            Pagás por combinadas,
            <br />
            no por promesas.
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-[var(--color-ink-muted)]">
            Cada combinada que arma el agente cuenta como un uso. Elegí cuántos querés por
            mes — el precio por combinada se desploma cuando vas en serio.
          </p>
        </div>
      </Reveal>

      <div className="mx-auto mt-14 grid max-w-6xl items-stretch gap-5 lg:grid-cols-3">
        {PLANS.map((plan, i) => {
          const perRun = pricePerRun(plan);
          const highlight = plan.highlighted;
          return (
            <Reveal key={plan.id} delay={i * 100} className={highlight ? "lg:-my-3" : ""}>
              <div
                className={`card relative flex h-full flex-col p-7 ${highlight ? "" : "card-hover"}`}
                style={
                  highlight
                    ? {
                        borderColor: "rgba(184,255,53,0.45)",
                        boxShadow:
                          "0 0 0 1px rgba(184,255,53,0.25) inset, 0 30px 80px -40px rgba(184,255,53,0.5)",
                        background:
                          "linear-gradient(180deg, rgba(184,255,53,0.06), rgba(255,255,255,0.012))",
                      }
                    : undefined
                }
              >
                {plan.badge && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-semibold"
                    style={{ background: "var(--color-edge)", color: "#0a1200" }}
                  >
                    {plan.badge}
                  </span>
                )}

                <div className="flex items-baseline justify-between">
                  <h2 className="font-display text-xl font-extrabold">{plan.name}</h2>
                </div>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{plan.tagline}</p>

                {/* Price */}
                <div className="mt-6 flex items-end gap-1.5">
                  <span
                    className="font-display font-black leading-none tnum"
                    style={{ fontSize: "2.8rem", letterSpacing: "-0.03em" }}
                  >
                    {plan.priceArs === 0 ? "$0" : formatArs(plan.priceArs)}
                  </span>
                  <span className="mb-1 text-sm text-[var(--color-ink-muted)]">/mes</span>
                </div>

                {/* Anchor: price per combo */}
                <div className="mt-3 h-6">
                  {perRun !== null ? (
                    <span
                      className="chip tnum"
                      style={
                        highlight
                          ? { color: "var(--color-edge)", borderColor: "rgba(184,255,53,0.4)", background: "rgba(184,255,53,0.08)" }
                          : undefined
                      }
                    >
                      ≈ {formatArs(perRun)} por combinada
                    </span>
                  ) : (
                    <span className="chip">Sin tarjeta</span>
                  )}
                </div>

                {/* Runs highlight */}
                <div className="mt-6 border-y border-[var(--line)] py-4">
                  <span
                    className="font-display text-2xl font-black tnum"
                    style={{ color: highlight ? "var(--color-edge)" : "var(--color-gold)" }}
                  >
                    {plan.runs}
                  </span>
                  <span className="ml-1.5 text-sm text-[var(--color-ink-muted)]">combinadas / mes</span>
                </div>

                {/* Features */}
                <ul className="mt-5 flex-1 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f.label} className="flex items-start gap-2.5 text-sm">
                      {f.included ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-0.5 shrink-0">
                          <path d="M5 13l4 4L19 7" stroke="var(--color-edge)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-0.5 shrink-0">
                          <path d="M6 12h12" stroke="var(--color-ink-faint)" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      )}
                      <span className={f.included ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)] line-through"}>
                        {f.label}
                      </span>
                    </li>
                  ))}
                </ul>

                {plan.nudge && (
                  <p
                    className="mt-5 rounded-xl px-3 py-2.5 text-xs leading-relaxed"
                    style={
                      highlight
                        ? { background: "rgba(184,255,53,0.1)", color: "var(--color-edge)" }
                        : { background: "rgba(255,255,255,0.03)", color: "var(--color-ink-muted)" }
                    }
                  >
                    {plan.nudge}
                  </p>
                )}

                <PlanCta planId={plan.id} label={plan.cta} primary={Boolean(highlight)} />
              </div>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={200}>
        <p className="mx-auto mt-10 max-w-xl text-center text-xs text-[var(--color-ink-muted)]">
          Precios en pesos argentinos, sin impuestos incluidos. Cancelás cuando quieras.
          Las combinadas no usadas no se acumulan al mes siguiente. BETIA da recomendaciones
          informativas — no coloca apuestas.
        </p>
      </Reveal>
    </div>
  );
}
