import { auth } from "@clerk/nextjs/server";
import { getPreapproval, mpEnabled, syncPendingCheckout, syncPreapproval } from "@/lib/mercadopago";

/**
 * Called by the dashboard after checkout, so the new plan shows up immediately
 * instead of whenever the webhook lands. With `preapprovalId` (MP's redirect
 * passed it) it syncs that one; without it, the user's last started checkout.
 * Same idempotent sync as the webhook either way.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!mpEnabled()) return Response.json({ error: "payments_disabled" }, { status: 503 });

  const { preapprovalId } = (await req.json().catch(() => ({}))) as { preapprovalId?: string };

  if (!preapprovalId) {
    const outcome = await syncPendingCheckout(userId);
    return Response.json({ outcome: outcome ?? "none" });
  }

  // Only the subscription's owner may trigger a sync from here.
  const pre = await getPreapproval(preapprovalId);
  if (!pre || pre.external_reference?.split(":")[0] !== userId) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const result = await syncPreapproval(preapprovalId);
  return Response.json({ status: pre.status, outcome: result?.outcome ?? "ignored" });
}
