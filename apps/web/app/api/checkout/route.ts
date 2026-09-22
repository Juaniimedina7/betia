import { auth, currentUser } from "@clerk/nextjs/server";
import { getDb, users } from "@bet/db";
import { eq } from "drizzle-orm";
import { createPreapproval, mpEnabled } from "@/lib/mercadopago";
import { ensureUser, getSubscription } from "@/lib/usage";
import type { PlanId } from "@/lib/plans";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  if (!mpEnabled()) {
    return Response.json({ error: "payments_disabled" }, { status: 503 });
  }

  const { planId } = (await req.json()) as { planId?: PlanId };
  if (planId !== "starter" && planId !== "pro") {
    return Response.json({ error: "invalid_plan" }, { status: 400 });
  }

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;
  await ensureUser(userId, email);

  // Switching plans is fine (the old subscription is cancelled once the new
  // one is authorized); re-buying the plan you're already paying for isn't.
  const sub = await getSubscription(userId);
  if (sub.planId === planId && sub.status === "active") {
    return Response.json({ error: "already_on_plan" }, { status: 409 });
  }

  const origin = new URL(req.url).origin;
  try {
    const { url, id } = await createPreapproval({ planId, userId, email, baseUrl: origin });
    // Lets the dashboard confirm it on the next visit, however the user comes back.
    await getDb().update(users).set({ mpPendingPreapprovalId: id }).where(eq(users.id, userId));
    return Response.json({ url });
  } catch (e) {
    // MP's raw error (status + body) stays in the server log, never in the UI.
    console.error("[checkout] createPreapproval failed", e);
    return Response.json({ error: "checkout_failed" }, { status: 500 });
  }
}
