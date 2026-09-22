import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb, planIds, users } from "@bet/db";
import { and, eq } from "drizzle-orm";
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
      // MP rejects mixing a test seller with a real payer ("Both payer and
      // collector must be real or test users"), so sandbox runs force the
      // test buyer's email. Must be unset with production credentials.
      payer_email: process.env.MP_SANDBOX_PAYER_EMAIL || opts.email,
      // MP appends ?preapproval_id=... — the dashboard uses it to confirm
      // right away instead of waiting on the webhook.
      back_url: `${opts.baseUrl}/?suscripcion=ok`,
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
  date_created?: string;
  next_payment_date?: string;
  summarized?: { last_charged_date?: string | null };
}

export async function getPreapproval(id: string): Promise<Preapproval | null> {
  const res = await fetch(`${MP_API}/preapproval/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as Preapproval;
}

export async function cancelPreapproval(id: string): Promise<void> {
  const res = await fetch(`${MP_API}/preapproval/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: JSON.stringify({ status: "cancelled" }),
  });
  if (!res.ok) {
    throw new Error(`MP cancel failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

/**
 * End of the period the user already paid for: the next charge date if MP
 * still reports one, else one month after the last charge, else now (never
 * charged — nothing to honor).
 */
export function paidUntil(pre: Preapproval, now: Date = new Date()): Date {
  const next = pre.next_payment_date ? new Date(pre.next_payment_date) : null;
  if (next && next > now) return next;

  const last = pre.summarized?.last_charged_date ? new Date(pre.summarized.last_charged_date) : null;
  if (last) {
    const end = new Date(last);
    end.setMonth(end.getMonth() + 1);
    if (end > now) return end;
  }
  return now;
}

function parseReference(ref: string | undefined): { userId: string; planId: PlanId } | null {
  const [userId, planId] = (ref ?? "").split(":");
  if (!userId || !planIds.includes(planId as PlanId)) return null;
  return { userId, planId: planId as PlanId };
}

export type SyncOutcome = "activated" | "cancelled" | "paused" | "superseded" | "ignored";

/**
 * Re-reads a preapproval from MP (our own token, so the payload can't be
 * forged) and syncs the owning user's plan. Shared by the webhook and the
 * post-checkout confirm endpoint, so it must be idempotent.
 *
 * A user holds at most one live subscription, `users.mpPreapprovalId`:
 * - a newly authorized one replaces it, and the old one is cancelled at MP
 *   only then — so abandoning a checkout never leaves the user without a plan;
 * - events for any other preapproval (the replaced one, an abandoned
 *   checkout) never touch the plan, so the replaced one's "cancelled" event
 *   can't downgrade the user.
 */
export async function syncPreapproval(
  id: string,
): Promise<{ userId: string; planId: PlanId; outcome: SyncOutcome } | null> {
  const pre = await getPreapproval(id);
  const ref = parseReference(pre?.external_reference);
  if (!pre || !ref) return null;

  const db = getDb();
  const [user] = await db
    .select({ planStatus: users.planStatus, mpPreapprovalId: users.mpPreapprovalId })
    .from(users)
    .where(eq(users.id, ref.userId))
    .limit(1);
  if (!user) return null;

  const current = user.mpPreapprovalId;
  const result = (outcome: SyncOutcome) => ({ userId: ref.userId, planId: ref.planId, outcome });

  if (pre.status === "authorized") {
    if (current === pre.id) {
      // Webhook retry, or the confirm endpoint racing the webhook.
      if (user.planStatus !== "active") {
        await db
          .update(users)
          .set({ planStatus: "active", planExpiresAt: null, planUpdatedAt: new Date() })
          .where(eq(users.id, ref.userId));
      }
      return result("activated");
    }

    if (current) {
      // An older subscription whose cancel failed can still send "authorized"
      // after the user moved on — keep the newest one and kill the stale one.
      const cur = await getPreapproval(current);
      if (
        cur?.status === "authorized" &&
        Date.parse(cur.date_created ?? "") > Date.parse(pre.date_created ?? "")
      ) {
        await cancelPreapproval(pre.id).catch(() => {});
        return result("superseded");
      }
    }

    await db
      .update(users)
      .set({
        plan: ref.planId,
        planStatus: "active",
        mpPreapprovalId: pre.id,
        planExpiresAt: null,
        planUpdatedAt: new Date(),
      })
      .where(eq(users.id, ref.userId));
    // No proration: the old plan's month is simply not refunded.
    if (current) await cancelPreapproval(current).catch(() => {});
    return result("activated");
  }

  if (current !== pre.id) return result("ignored");

  if (pre.status === "cancelled") {
    // Already handled by /settings/suscripcion (which set planExpiresAt from
    // the still-active preapproval) — don't overwrite it with a worse guess.
    if (user.planStatus !== "cancelled") {
      await db
        .update(users)
        .set({ planStatus: "cancelled", planExpiresAt: paidUntil(pre), planUpdatedAt: new Date() })
        .where(eq(users.id, ref.userId));
    }
    return result("cancelled");
  }

  if (pre.status === "paused") {
    await db
      .update(users)
      .set({ planStatus: "paused", planUpdatedAt: new Date() })
      .where(eq(users.id, ref.userId));
    return result("paused");
  }

  return result("ignored");
}

/** A checkout still unpaid after this long is treated as abandoned. */
const PENDING_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Confirms the user's last started checkout (`users.mpPendingPreapprovalId`)
 * without needing MP to pass the id back — its "Volver" button doesn't. Called
 * by the dashboard on load. Clears the pending id once MP has resolved it
 * (paid or cancelled) or the checkout was abandoned; keeps it while the
 * user may still be paying.
 */
export async function syncPendingCheckout(userId: string): Promise<SyncOutcome | null> {
  const db = getDb();
  const [row] = await db
    .select({ pending: users.mpPendingPreapprovalId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const id = row?.pending;
  if (!id) return null;

  const pre = await getPreapproval(id);
  const stillPaying =
    pre?.status === "pending" && Date.now() - Date.parse(pre.date_created ?? "") < PENDING_CHECKOUT_TTL_MS;
  if (stillPaying) return null;

  const outcome = pre && pre.status !== "pending" ? ((await syncPreapproval(id))?.outcome ?? null) : null;
  // Only clear if no newer checkout replaced it meanwhile.
  await db
    .update(users)
    .set({ mpPendingPreapprovalId: null })
    .where(and(eq(users.id, userId), eq(users.mpPendingPreapprovalId, id)));
  return outcome;
}

/**
 * Validates MP's `x-signature` header (HMAC-SHA256 over
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` keyed by the webhook
 * secret from the MP panel). Returns null when MP_WEBHOOK_SECRET isn't set,
 * so callers can decide how strict to be.
 */
export function verifyWebhookSignature(req: Request, dataId: string | null): boolean | null {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return null;

  const header = req.headers.get("x-signature");
  if (!header) return false;

  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, ...v] = kv.split("=");
      return [k.trim(), v.join("=").trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  // Per MP's docs: alphanumeric ids are signed lowercased, and any missing
  // piece is left out of the manifest entirely.
  const requestId = req.headers.get("x-request-id");
  let manifest = "";
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
