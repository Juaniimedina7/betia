import { getDb, planIds, users } from "@bet/db";
import { eq } from "drizzle-orm";
import { getPreapproval } from "@/lib/mercadopago";

/** MP pings this on subscription events. We re-fetch the preapproval from MP
 *  (using our own token) as verification, then sync the user's plan. */
async function handle(id: string | null, topic: string | null) {
  if (!id) return;
  if (topic && !topic.includes("preapproval") && !topic.includes("subscription")) return;

  const pre = await getPreapproval(id);
  if (!pre?.external_reference) return;

  const [refUserId, planId] = pre.external_reference.split(":");
  if (!refUserId || !planIds.includes(planId as (typeof planIds)[number])) return;

  const db = getDb();
  if (pre.status === "authorized") {
    await db
      .update(users)
      .set({ plan: planId as (typeof planIds)[number], planStatus: "active", mpPreapprovalId: id, planUpdatedAt: new Date() })
      .where(eq(users.id, refUserId));
  } else if (pre.status === "cancelled") {
    await db
      .update(users)
      .set({ plan: "free", planStatus: "cancelled", planUpdatedAt: new Date() })
      .where(eq(users.id, refUserId));
  } else if (pre.status === "paused") {
    await db.update(users).set({ planStatus: "paused", planUpdatedAt: new Date() }).where(eq(users.id, refUserId));
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  let id = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  let topic = url.searchParams.get("type") ?? url.searchParams.get("topic");

  try {
    const body = (await req.json()) as { data?: { id?: string }; type?: string; action?: string };
    id = id ?? body?.data?.id ?? null;
    topic = topic ?? body?.type ?? null;
  } catch {
    // MP sometimes sends empty/non-JSON bodies; query params cover those.
  }

  try {
    await handle(id, topic);
  } catch {
    // Never fail the webhook — MP retries on non-2xx.
  }
  return new Response("ok", { status: 200 });
}

export function GET() {
  return new Response("ok", { status: 200 });
}
