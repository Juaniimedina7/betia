import { getDb } from "./client";
import { users } from "./schema";

/**
 * Ensures a `users` row exists for this Clerk id before any FK'd insert
 * (bet_slips, monthly_usage) references it. The Clerk webhook normally
 * creates it (apps/web/app/api/webhooks/clerk/route.ts), but it isn't
 * configured everywhere (missing CLERK_WEBHOOK_SIGNING_SECRET), and admin
 * users skip the chat-quota path that also calls this — callers can't assume
 * the row already exists. A placeholder email is corrected later by the
 * webhook, or by a future call to this function with a real one.
 */
export async function ensureUserExists(userId: string, email?: string): Promise<void> {
  const db = getDb();
  await db
    .insert(users)
    .values({ id: userId, email: email || `${userId}@pending.betia` })
    .onConflictDoNothing({ target: users.id });
}
