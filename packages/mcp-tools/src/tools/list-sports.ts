import { getDb, sportsCache } from "@bet/db";
import { getOddsPapiClient, type Sport } from "@bet/oddspapi-client";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { toUserFacingError } from "../user-facing-error";

export const listSportsInput = z.object({
  activeOnly: z.boolean().optional(),
});

export type ListSportsInput = z.infer<typeof listSportsInput>;

// Product scope for now: only these sports, shown with Spanish names. Keyed by
// OddsPapi's sportId (see GET /v4/sports for the full catalog).
// Order here is the display order: most popular sport first.
const SPANISH_SPORT_NAMES: Record<string, string> = {
  "10": "Fútbol",
  "11": "Básquet",
  "12": "Tenis",
  "26": "Rugby",
};

function localizeSports(sports: Sport[]): Sport[] {
  return sports
    .filter((s) => s.sportId in SPANISH_SPORT_NAMES)
    .map((s) => ({ ...s, name: SPANISH_SPORT_NAMES[s.sportId]! }))
    .sort(
      (a, b) =>
        Object.keys(SPANISH_SPORT_NAMES).indexOf(a.sportId) -
        Object.keys(SPANISH_SPORT_NAMES).indexOf(b.sportId),
    );
}

export async function listSports(_input: ListSportsInput) {
  try {
    const sports = localizeSports(await getOddsPapiClient().listSports());
    await cacheSports(sports);
    return { sports, source: "live" as const, cachedAt: undefined as string | undefined };
  } catch (liveError) {
    const cached = await readCachedSports();
    if (cached.sports.length > 0) {
      return { ...cached, sports: localizeSports(cached.sports), source: "cache" as const };
    }
    throw toUserFacingError(liveError);
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
