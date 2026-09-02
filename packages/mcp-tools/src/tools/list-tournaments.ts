import { getDb, sportsCache } from "@bet/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const listTournamentsInput = z.object({
  // Actually a sports_cache "group" (e.g. "Soccer") — kept as `sportId` to match
  // list_sports' output field without renaming call sites.
  sportId: z.string(),
});

export type ListTournamentsInput = z.infer<typeof listTournamentsInput>;

export interface TournamentSummary {
  tournamentId: string; // The Odds API sport_key (e.g. "soccer_epl") — the actual leaf identifier
  sportId: string; // the group this sport_key belongs to
  name: string;
  /** The Odds API's /v4/sports has no country field — always undefined. Kept for
   * apps/web/lib/popular-leagues.ts's shape; its country-based ranking degrades to
   * "Internacional" for everything, a known UX regression from the provider switch. */
  countryCode?: string;
}

/**
 * DB-only read of sports_cache, filtered to one group — plays the role OddsPapi's
 * tournaments-within-a-sport used to play. There's no separate tournament level on
 * this provider; every sport_key already is one league.
 */
export async function listTournaments(input: ListTournamentsInput) {
  try {
    const db = getDb();
    const rows = await db.select().from(sportsCache).where(eq(sportsCache.group, input.sportId));
    const tournaments: TournamentSummary[] = rows.map((r) => ({
      tournamentId: r.sportKey,
      sportId: r.group,
      name: r.title,
    }));
    return { tournaments, source: "cache" as const };
  } catch {
    return { tournaments: [] as TournamentSummary[], source: "cache" as const };
  }
}
