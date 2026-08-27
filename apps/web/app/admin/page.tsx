import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, monthlyUsage, planIds, users } from "@bet/db";
import { and, desc, eq } from "drizzle-orm";
import { currentUserIsAdmin } from "@/lib/admin";
import { currentPeriod } from "@/lib/usage";
import { PLAN_BY_ID, formatArs, type PlanId } from "@/lib/plans";

export const dynamic = "force-dynamic";

async function setPlan(formData: FormData) {
  "use server";
  if (!(await currentUserIsAdmin())) return;
  const userId = formData.get("userId") as string;
  const plan = formData.get("plan") as PlanId;
  if (!userId || !planIds.includes(plan)) return;
  await getDb()
    .update(users)
    .set({ plan, planStatus: "active", planUpdatedAt: new Date() })
    .where(eq(users.id, userId));
  revalidatePath("/admin");
}

export default async function AdminPage() {
  if (!(await currentUserIsAdmin())) redirect("/");

  const period = currentPeriod();
  const db = getDb();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      plan: users.plan,
      planStatus: users.planStatus,
      createdAt: users.createdAt,
      runCount: monthlyUsage.runCount,
    })
    .from(users)
    .leftJoin(
      monthlyUsage,
      and(eq(monthlyUsage.userId, users.id), eq(monthlyUsage.period, period)),
    )
    .orderBy(desc(users.createdAt));

  return (
    <div className="container-page max-w-4xl py-14">
      <span className="eyebrow">Panel interno</span>
      <h1
        className="mt-3 font-display font-extrabold leading-tight"
        style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", letterSpacing: "-0.03em" }}
      >
        Admin
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        {rows.length} usuarios · uso del período {period}. Los admins (rol en Clerk) tienen
        combinadas ilimitadas sin importar el plan.
      </p>

      <div className="card mt-8 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">
              <th className="px-5 py-3 font-medium">Usuario</th>
              <th className="px-3 py-3 font-medium">Plan</th>
              <th className="px-3 py-3 font-medium">Uso del mes</th>
              <th className="px-5 py-3 text-right font-medium">Cambiar plan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const limit = PLAN_BY_ID[row.plan as PlanId]?.runs ?? 0;
              const used = row.runCount ?? 0;
              return (
                <tr key={row.id} className="border-t border-[var(--line)]">
                  <td className="px-5 py-3">
                    <p className="font-medium">{row.email}</p>
                    <p className="text-xs text-[var(--color-ink-faint)] tnum">{row.id}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="chip">{row.plan}</span>
                  </td>
                  <td className="px-3 py-3 tnum text-[var(--color-ink-muted)]">
                    {used} / {limit}
                  </td>
                  <td className="px-5 py-3">
                    <form action={setPlan} className="flex items-center justify-end gap-2">
                      <input type="hidden" name="userId" value={row.id} />
                      <select
                        name="plan"
                        defaultValue={row.plan}
                        className="rounded-lg border border-[var(--line-strong)] bg-transparent px-2 py-1.5 text-sm outline-none"
                      >
                        {planIds.map((p) => (
                          <option key={p} value={p} className="bg-[var(--color-pitch-850)]">
                            {p} · {formatArs(PLAN_BY_ID[p].priceArs)}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn-ghost !px-3 !py-1.5 !text-sm">
                        Guardar
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
