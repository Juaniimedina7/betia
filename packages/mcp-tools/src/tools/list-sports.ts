import { getDb, sportsCache } from "@bet/db";
import { inArray } from "drizzle-orm";
import { z } from "zod";

export const listSportsInput = z.object({});

export type ListSportsInput = z.infer<typeof listSportsInput>;

export interface SportGroup {
  sportId: string; // the sports_cache "group" value (e.g. "Soccer") — used as list_tournaments' input
  name: string;
}

// Product scope: every watched league is soccer today (see watched-sport-keys.ts), so
// this is the only group with anything behind it in odds_cache — showing "Básquet" or
// "Tenis" here would be a dead end regardless of what's in sports_cache. Expand this
// once non-soccer leagues are added to the watchlist.
const SPANISH_GROUP_NAMES: Record<string, string> = {
  Soccer: "Fútbol",
};

/**
 * DB-only read of sports_cache, which /api/ingest/poll refreshes every run — no live
 * call, no cache-fallback-write (that whole distinction goes away once nothing here is
 * ever live). Returns the small set of sport "groups" this product actually covers.
 */
export async function listSports(_input: ListSportsInput) {
  try {
    const db = getDb();
    const rows = await db
      .select({ group: sportsCache.group })
      .from(sportsCache)
      .where(inArray(sportsCache.group, Object.keys(SPANISH_GROUP_NAMES)));
    const groups = [...new Set(rows.map((r) => r.group))];
    const sports: SportGroup[] = groups
      .map((group) => ({ sportId: group, name: SPANISH_GROUP_NAMES[group] ?? group }))
      .sort(
        (a, b) => Object.keys(SPANISH_GROUP_NAMES).indexOf(a.sportId) - Object.keys(SPANISH_GROUP_NAMES).indexOf(b.sportId),
      );
    return { sports, source: "cache" as const };
  } catch {
    return { sports: [] as SportGroup[], source: "cache" as const };
  }
}
