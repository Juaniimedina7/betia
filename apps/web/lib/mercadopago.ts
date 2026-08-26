import { PLAN_BY_ID, type PlanId } from "./plans";

const MP_API = "https://api.mercadopago.com";

export function mpEnabled(): boolean {
  return Boolean(process.env.MP_ACCESS_TOKEN);
}

function token(): string {
  const t = process.env.MP_ACCESS_TOKEN;
  if (!t) throw new Error("MP_ACCESS_TOKEN is not set");
  return t;
}

/**
 * Creates a Mercado Pago recurring subscription (preapproval) for a paid plan
 * and returns the checkout URL. external_reference carries "userId:planId" so
 * the webhook can attribute the payment back to the user.
 */
export async function createPreapproval(opts: {
  planId: PlanId;
  userId: string;
  email?: string;
  baseUrl: string;
}): Promise<{ url: string; id: string }> {
  const plan = PLAN_BY_ID[opts.planId];
  if (!plan || plan.priceArs <= 0) {
    throw new Error(`Plan ${opts.planId} no es cobrable`);
  }

  const res = await fetch(`${MP_API}/preapproval`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: JSON.stringify({
      reason: `BETIA ${plan.name}`,
      external_reference: `${opts.userId}:${opts.planId}`,
      payer_email: opts.email,
      back_url: `${opts.baseUrl}/bets?suscripcion=ok`,
      status: "pending",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: plan.priceArs,
        currency_id: "ARS",
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`MP preapproval failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as { id: string; init_point?: string; sandbox_init_point?: string };
  const url = data.init_point ?? data.sandbox_init_point;
  if (!url) throw new Error("MP no devolvió init_point");
  return { url, id: data.id };
}

export interface Preapproval {
  id: string;
  status: "authorized" | "pending" | "paused" | "cancelled";
  external_reference?: string;
}

export async function getPreapproval(id: string): Promise<Preapproval | null> {
  const res = await fetch(`${MP_API}/preapproval/${id}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as Preapproval;
}
