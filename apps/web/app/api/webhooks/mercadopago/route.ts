import { getDb, mpWebhookEvents } from "@bet/db";
import { syncPreapproval, verifyWebhookSignature } from "@/lib/mercadopago";

/** Best-effort audit row per hit — a logging failure must never fail the webhook. */
async function record(event: typeof mpWebhookEvents.$inferInsert) {
  try {
    await getDb().insert(mpWebhookEvents).values(event);
  } catch (e) {
    console.error("[mp-webhook] could not record event", e);
  }
}

/** MP pings this on subscription events. We check MP's signature, then
 *  re-fetch the preapproval from MP (our own token) and sync the user's plan. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  // MP signs the id from the query string, so read it before the body.
  const signedId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  let id = signedId;
  let topic = url.searchParams.get("type") ?? url.searchParams.get("topic");

  const signature = verifyWebhookSignature(req, signedId);
  if (signature === false) {
    await record({ query: url.search, topic, dataId: signedId, signatureOk: false, outcome: "rejected" });
    return new Response("invalid signature", { status: 401 });
  }
  if (signature === null) {
    // Still safe (syncPreapproval never trusts the payload), just unverified.
    console.warn("[mp-webhook] MP_WEBHOOK_SECRET not set — skipping signature check");
  }

  try {
    const body = (await req.json()) as { data?: { id?: string }; type?: string; action?: string };
    id = id ?? body?.data?.id ?? null;
    topic = topic ?? body?.type ?? null;
  } catch {
    // MP sometimes sends empty/non-JSON bodies; query params cover those.
  }

  let outcome = "skipped";
  let error: string | undefined;
  // Payment events (subscription_authorized_payment, payment) aren't handled yet.
  if (id && (!topic || topic.includes("preapproval"))) {
    try {
      outcome = (await syncPreapproval(id))?.outcome ?? "not_ours";
    } catch (e) {
      // Never fail the webhook — MP retries on non-2xx.
      outcome = "error";
      error = e instanceof Error ? e.message : String(e);
      console.error("[mp-webhook] sync failed", e);
    }
  }

  await record({ query: url.search, topic, dataId: id, signatureOk: signature, outcome, error });
  return new Response("ok", { status: 200 });
}

export function GET() {
  return new Response("ok", { status: 200 });
}
