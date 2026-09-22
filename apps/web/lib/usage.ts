import { ensureUserExists, getDb, monthlyUsage, users } from "@bet/db";
import { and, eq, sql } from "drizzle-orm";
import { PLAN_BY_ID, type PlanId } from "./plans";

/** Calendar month bucket in UTC, e.g. "2026-08". */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Re-exported for existing callers (e.g. the checkout route) — see @bet/db's ensureUserExists. */
export const ensureUser = ensureUserExists;

export interface Subscription {
  /** Plan the user is billed/entitled for right now, after applying expiry. */
  planId: PlanId;
  status: "active" | "paused" | "cancelled";
  /** Set only for a cancelled plan still inside its paid month. */
  expiresAt: Date | null;
  mpPreapprovalId: string | null;
  /** A checkout was started and not yet resolved — see syncPendingCheckout. */
  hasPendingCheckout: boolean;
}

/**
 * A cancelled paid plan keeps applying until `planExpiresAt` (end of the
 * month already charged), then falls back to Free.
 */
export async function getSubscription(userId: string, now: Date = new Date()): Promise<Subscription> {
  const db = getDb();
  const [row] = await db
    .select({
      plan: users.plan,
      planStatus: users.planStatus,
      planExpiresAt: users.planExpiresAt,
      mpPreapprovalId: users.mpPreapprovalId,
      mpPendingPreapprovalId: users.mpPendingPreapprovalId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) {
    return { planId: "free", status: "active", expiresAt: null, mpPreapprovalId: null, hasPendingCheckout: false };
  }

  const expired = row.planStatus === "cancelled" && (!row.planExpiresAt || row.planExpiresAt <= now);
  return {
    planId: expired ? "free" : (row.plan as PlanId),
    status: row.planStatus,
    expiresAt: expired ? null : row.planExpiresAt,
    mpPreapprovalId: row.mpPreapprovalId,
    hasPendingCheckout: row.mpPendingPreapprovalId !== null,
  };
}

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

  const { planId } = await getSubscription(userId);
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
