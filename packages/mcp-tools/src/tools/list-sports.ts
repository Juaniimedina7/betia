import { getDb, sportsCache } from "@bet/db";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { resolveByName } from "../fuzzy-match";

export const listSportsInput = z.object({});

export type ListSportsInput = z.infer<typeof listSportsInput>;

export interface SportGroup {
  sportId: string; // the sports_cache "group" value (e.g. "Soccer") — used as list_tournaments' input
  name: string;
}

// Product scope (2026-09-03): the four sport groups actually behind odds_cache — see
// watched-sport-keys.ts. Order here is display order in list_sports' response.
export const SPANISH_GROUP_NAMES: Record<string, string> = {
  Soccer: "Fútbol",
  Basketball: "Básquet",
  "American Football": "NFL",
  Tennis: "Tenis",
};

/**
 * Resolves a caller-given sport name (English group value like "Soccer", a casing
 * variant like "soccer", or its Spanish display name like "Fútbol"/"futbol") to the
 * literal `sports_cache.group` string other tools (build_combo's `sports` param) match
 * against exactly. Found necessary 2026-09-10: `build_combo`'s old exact-match-only
 * lookup silently returned "no torneos encontrados" for ANY casing/language mismatch —
 * indistinguishable from genuinely having no cached data for that sport, which made a
 * real agent conversation look like a data outage when it was actually just an
 * unresolved sport name (confirmed live: "soccer"/"Fútbol"/"Futbol" all failed while the
 * literal "Soccer" succeeded, against identical cached data).
 */
export function resolveSportGroup(input: string, availableGroups: string[]): string | undefined {
  const direct = resolveByName(input, availableGroups);
  if (direct) return direct;

  const spanishEntries = Object.entries(SPANISH_GROUP_NAMES).filter(([group]) => availableGroups.includes(group));
  const matchedSpanish = resolveByName(
    input,
    spanishEntries.map(([, es]) => es),
  );
  return spanishEntries.find(([, es]) => es === matchedSpanish)?.[0];
}

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
