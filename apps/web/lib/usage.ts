import { ensureUserExists, getDb, monthlyUsage, users } from "@bet/db";
import { and, eq, sql } from "drizzle-orm";
import { PLAN_BY_ID, type PlanId } from "./plans";

/** Calendar month bucket in UTC, e.g. "2026-08". */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Re-exported for existing callers (e.g. the checkout route) — see @bet/db's ensureUserExists. */
export const ensureUser = ensureUserExists;

export interface UsageSnapshot {
  planId: PlanId;
  used: number;
  limit: number;
  remaining: number;
  period: string;
}

export async function getUsage(userId: string): Promise<UsageSnapshot> {
  const db = getDb();
  const period = currentPeriod();

  const [userRow] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const planId = (userRow?.plan as PlanId) ?? "free";
  const limit = PLAN_BY_ID[planId].runs;

  const [usageRow] = await db
    .select({ runCount: monthlyUsage.runCount })
    .from(monthlyUsage)
    .where(and(eq(monthlyUsage.userId, userId), eq(monthlyUsage.period, period)))
    .limit(1);
  const used = usageRow?.runCount ?? 0;

  return { planId, used, limit, remaining: Math.max(0, limit - used), period };
}

/**
 * Atomically consumes one run if quota allows. Returns allowed=false without
 * incrementing when the monthly limit is reached.
 */
export async function consumeRun(
  userId: string,
  email?: string,
): Promise<{ allowed: boolean } & UsageSnapshot> {
  await ensureUser(userId, email);
  const snapshot = await getUsage(userId);
  if (snapshot.used >= snapshot.limit) {
    return { allowed: false, ...snapshot };
  }

  const db = getDb();
  await db
    .insert(monthlyUsage)
    .values({ userId, period: snapshot.period, runCount: 1 })
    .onConflictDoUpdate({
      target: [monthlyUsage.userId, monthlyUsage.period],
      set: { runCount: sql`${monthlyUsage.runCount} + 1`, updatedAt: new Date() },
    });

  return {
    allowed: true,
    ...snapshot,
    used: snapshot.used + 1,
    remaining: Math.max(0, snapshot.limit - snapshot.used - 1),
  };
}
