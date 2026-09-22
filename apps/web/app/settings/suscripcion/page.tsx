import Link from "next/link";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { getDb, users } from "@bet/db";
import { eq } from "drizzle-orm";
import { cancelPreapproval, getPreapproval, mpEnabled, paidUntil } from "@/lib/mercadopago";
import { PLAN_BY_ID, formatArs } from "@/lib/plans";
import { getSubscription } from "@/lib/usage";
import { CancelSubscription } from "./cancel-subscription";

export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

async function cancelSubscription(): Promise<string | undefined> {
  "use server";
  const { userId } = await auth();
  if (!userId) return "Tenés que iniciar sesión.";

  const sub = await getSubscription(userId);
  if (sub.status !== "active" || !sub.mpPreapprovalId) return "No tenés una suscripción activa.";

  // Read the paid period *before* cancelling — MP may drop next_payment_date after.
  const pre = await getPreapproval(sub.mpPreapprovalId).catch(() => null);
  const expiresAt = pre ? paidUntil(pre) : new Date();

  try {
    await cancelPreapproval(sub.mpPreapprovalId);
  } catch {
    return "No pudimos cancelar en Mercado Pago. Probá de nuevo en un rato.";
  }

  await getDb()
    .update(users)
    .set({ planStatus: "cancelled", planExpiresAt: expiresAt, planUpdatedAt: new Date() })
    .where(eq(users.id, userId));

  revalidatePath("/settings/suscripcion");
  return undefined;
}

export default async function SubscriptionPage() {
  const { userId } = await auth();
  const sub = await getSubscription(userId!);
  const plan = PLAN_BY_ID[sub.planId];
  const paid = plan.priceArs > 0;

  let nextCharge: Date | null = null;
  if (paid && sub.status === "active" && sub.mpPreapprovalId && mpEnabled()) {
    const pre = await getPreapproval(sub.mpPreapprovalId).catch(() => null);
    nextCharge = pre?.next_payment_date ? new Date(pre.next_payment_date) : null;
  }

  return (
    <div className="container-page max-w-2xl py-14">
      <span className="eyebrow">Tu cuenta</span>
      <h1
        className="mt-3 font-display font-extrabold leading-tight"
        style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.4rem)", letterSpacing: "-0.03em" }}
      >
        Suscripción
      </h1>

      <div className="card mt-8 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-extrabold">Plan {plan.name}</h2>
          {paid && (
            <span className="text-sm text-[var(--color-ink-muted)] tnum">{formatArs(plan.priceArs)}/mes</span>
          )}
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{plan.runs} combinadas por mes</p>

        <div className="mt-5 border-t border-[var(--line)] pt-5 text-sm">
          {!paid && (
            <p className="text-[var(--color-ink-muted)]">
              Estás en el plan gratis. Pasate a un plan pago para tener más combinadas y cuotas en vivo.
            </p>
          )}

          {paid && sub.status === "active" && (
            <p className="text-[var(--color-ink-muted)]">
              {nextCharge
                ? `Próximo cobro: ${formatDate(nextCharge)}, por Mercado Pago.`
                : "Se renueva todos los meses por Mercado Pago."}
            </p>
          )}

          {paid && sub.status === "cancelled" && sub.expiresAt && (
            <p className="text-[var(--color-ink-muted)]">
              Cancelaste tu suscripción. Seguís con {plan.name} hasta el{" "}
              <span className="text-[var(--color-ink)]">{formatDate(sub.expiresAt)}</span>; después pasás
              a Free. No se te va a cobrar de nuevo.
            </p>
          )}

          {paid && sub.status === "paused" && (
            <p className="text-[var(--color-ink-muted)]">
              Tu suscripción está pausada en Mercado Pago — suele pasar cuando se rechaza un cobro. Revisá
              tu medio de pago desde tu cuenta de Mercado Pago.
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/pricing" className="btn btn-ghost">
            {!paid ? "Ver planes" : sub.status === "cancelled" ? "Volver a suscribirme" : "Cambiar de plan"}
          </Link>
          {paid && sub.status === "active" && sub.mpPreapprovalId && (
            <CancelSubscription cancel={cancelSubscription} planName={plan.name} />
          )}
        </div>
      </div>

      {paid && sub.status === "active" && (
        <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
          Si cambiás de plan, el nuevo se cobra completo desde ese día y el mes del plan anterior no se
          reintegra.
        </p>
      )}
    </div>
  );
}
