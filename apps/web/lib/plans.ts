/**
 * Plan definitions — single source of truth for the pricing page and (later)
 * run-limit enforcement + checkout. Prices in ARS, "runs" = agent combos/month.
 *
 * Pricing is intentionally shaped so Starter is dominated by Pro (asymmetric
 * dominance / decoy): Pro is only 75% more expensive but gives 15x the runs,
 * dropping the per-combo cost from ~$500 to ~$58. Starter exists mainly to make
 * Pro the obvious pick.
 */

export type PlanId = "free" | "starter" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in ARS. 0 = free. */
  priceArs: number;
  /** Agent combos ("runs") per month. null = effectively unlimited. */
  runs: number;
  /** Saved bet-slip history cap. null = unlimited. */
  historyCap: number | null;
  highlighted?: boolean;
  badge?: string;
  cta: string;
  /** Feature rows for the comparison card. `included` drives the check/dash. */
  features: Array<{ label: string; value?: string; included: boolean }>;
  /** Extra nudge shown only on this card. */
  nudge?: string;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Para probarle el olfato a BETIA",
    priceArs: 0,
    runs: 5,
    historyCap: 3,
    cta: "Empezar gratis",
    features: [
      { label: "5 combinadas por mes", included: true },
      { label: "Historial de 3 combinadas", included: true },
      { label: "Cuotas con retraso", included: true },
      { label: "Solo perfil balanceado", included: true },
      { label: "Cuotas en vivo", included: false },
      { label: "Acceso MCP (Claude Desktop)", included: false },
    ],
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "Para el finde",
    priceArs: 20000,
    runs: 40,
    historyCap: 25,
    cta: "Elegir Starter",
    nudge: "40 combinadas rinden 1 o 2 findes fuertes. Después te quedás corto.",
    features: [
      { label: "40 combinadas por mes", included: true },
      { label: "Historial de 25 combinadas", included: true },
      { label: "Cuotas en vivo", included: true },
      { label: "Los 3 perfiles de riesgo", included: true },
      { label: "Tuning avanzado de riesgo", included: false },
      { label: "Acceso MCP (Claude Desktop)", included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Para ir en serio",
    priceArs: 35000,
    runs: 600,
    historyCap: null,
    highlighted: true,
    badge: "Mejor valor",
    cta: "Pasarme a Pro",
    nudge: "15× las combinadas de Starter por apenas $15.000 más.",
    features: [
      { label: "600 combinadas por mes", included: true },
      { label: "Historial ilimitado", included: true },
      { label: "Cuotas en vivo prioritarias", included: true },
      { label: "Los 3 perfiles + tuning avanzado", included: true },
      { label: "Acceso MCP (Claude Desktop)", included: true },
      { label: "Soporte prioritario", included: true },
    ],
  },
];

export const PLAN_BY_ID = Object.fromEntries(PLANS.map((p) => [p.id, p])) as Record<PlanId, Plan>;

/** Formats an ARS amount as "$20.000". */
export function formatArs(amount: number): string {
  return `$${amount.toLocaleString("es-AR")}`;
}

/** Per-combo cost used as the anchoring number on paid cards. */
export function pricePerRun(plan: Plan): number | null {
  if (plan.priceArs === 0 || plan.runs === 0) return null;
  return Math.round(plan.priceArs / plan.runs);
}
