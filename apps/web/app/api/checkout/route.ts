import { auth, currentUser } from "@clerk/nextjs/server";
import { createPreapproval, mpEnabled } from "@/lib/mercadopago";
import { ensureUser } from "@/lib/usage";
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

  const origin = new URL(req.url).origin;
  try {
    const { url } = await createPreapproval({ planId, userId, email, baseUrl: origin });
    return Response.json({ url });
  } catch (e) {
    return Response.json(
      { error: "checkout_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
