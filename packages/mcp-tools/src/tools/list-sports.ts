import { getDb, sportsCache } from "@bet/db";
import { getOddsPapiClient, type Sport } from "@bet/oddspapi-client";
import { sql } from "drizzle-orm";
import { z } from "zod";

export const listSportsInput = z.object({
  activeOnly: z.boolean().optional(),
});

export type ListSportsInput = z.infer<typeof listSportsInput>;

export async function listSports(_input: ListSportsInput) {
  try {
    const sports = await getOddsPapiClient().listSports();
    await cacheSports(sports);
    return { sports, source: "live" as const, cachedAt: undefined as string | undefined };
  } catch (liveError) {
    const cached = await readCachedSports();
    if (cached.sports.length > 0) {
      return { ...cached, source: "cache" as const };
    }
    throw liveError;
  }
}

async function cacheSports(sports: Sport[]): Promise<void> {
  if (sports.length === 0) return;
  try {
    await getDb()
      .insert(sportsCache)
      .values(sports.map((s) => ({ sportId: s.sportId, name: s.name })))
      .onConflictDoUpdate({
        target: sportsCache.sportId,
        set: { name: sql`excluded.name`, updatedAt: sql`now()` },
      });
  } catch {
    // Best-effort backup — a DB hiccup shouldn't break the live response.
  }
}

async function readCachedSports(): Promise<{ sports: Sport[]; cachedAt: string | undefined }> {
  try {
    const rows = await getDb().select().from(sportsCache);
    const cachedAt = rows.reduce<Date | undefined>(
      (latest, r) => (!latest || r.updatedAt > latest ? r.updatedAt : latest),
      undefined,
    );
    return {
      sports: rows.map((r) => ({ sportId: r.sportId, name: r.name })),
      cachedAt: cachedAt?.toISOString(),
    };
  } catch {
    return { sports: [], cachedAt: undefined };
  }
}
