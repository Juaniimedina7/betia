import { auth } from "@clerk/nextjs/server";
import { getPreapproval, mpEnabled, syncPreapproval } from "@/lib/mercadopago";

/**
 * Called by the dashboard when MP redirects back after checkout, so the new
 * plan shows up immediately instead of whenever the webhook lands. Runs the
 * same idempotent sync as the webhook.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  if (!mpEnabled()) return Response.json({ error: "payments_disabled" }, { status: 503 });

  const { preapprovalId } = (await req.json().catch(() => ({}))) as { preapprovalId?: string };
  if (!preapprovalId) return Response.json({ error: "missing_id" }, { status: 400 });

  // Only the subscription's owner may trigger a sync from here.
  const pre = await getPreapproval(preapprovalId);
  if (!pre || pre.external_reference?.split(":")[0] !== userId) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const result = await syncPreapproval(preapprovalId);
  return Response.json({ status: pre.status, outcome: result?.outcome ?? "ignored" });
}
