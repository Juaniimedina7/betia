import { eq } from "drizzle-orm";
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

/**
 * Perfil de apuesta declarado por el usuario (`/profileTest`). Devuelve
 * "unspecified" tanto si la fila no existe todavía como si nunca hizo el test.
 */
export async function getUserBetProfile(userId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ betProfile: users.betProfile })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.betProfile ?? "unspecified";
}

/** Los cuatro perfiles que puede devolver el test (`unspecified` no se escribe nunca). */
export type SettableBetProfile = "risky" | "balanced" | "moderate" | "conservative";

/** Club elegido en `/profileTest`, ya validado contra la lista por el caller. */
export interface ProfileTestResult {
  betProfile: SettableBetProfile;
  /** `null` cuando el usuario eligió "Prefiero no decirlo" — borra el club anterior. */
  team: string | null;
}

/**
 * Guarda el resultado de `/profileTest`: perfil y club, en una sola escritura
 * porque salen del mismo intento. Crea la fila si el usuario todavía no la
 * tiene — el webhook de Clerk no está configurado en todos los entornos, así
 * que ninguna escritura contra `users` puede asumir que la fila ya existe
 * (mismo motivo que `ensureUserExists`).
 */
export async function saveProfileTestResult(
  userId: string,
  { betProfile, team }: ProfileTestResult,
): Promise<void> {
  const db = getDb();
  await ensureUserExists(userId);
  await db
    .update(users)
    .set({ betProfile, team, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/** Club del usuario, o `null` si nunca eligió uno. */
export async function getUserTeam(userId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ team: users.team })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.team ?? null;
}
