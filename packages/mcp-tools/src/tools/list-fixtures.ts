import { getDb, oddsCache } from "@bet/db";
import type { BookmakerOdds } from "@bet/odds-api-client";
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";

export const listFixturesInput = z.object({
  // Actually a sport_key (e.g. "soccer_epl") — kept as `tournamentId` to match
  // list_tournaments' output field without renaming call sites. `sportId` (a group
  // like "Soccer") has no matching column on odds_cache, so it's accepted but ignored.
  sportId: z.string().optional(),
  tournamentId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type ListFixturesInput = z.infer<typeof listFixturesInput>;

export interface FixtureSummary {
  fixtureId: string;
  sportKey: string;
  tournamentId: string; // same value as sportKey — kept for page compatibility
  homeTeam?: string;
  awayTeam?: string;
  startTime: string;
  bookmakerOdds?: BookmakerOdds;
}

/**
 * DB-only read of odds_cache — no live call, ever (build_combo/list_fixtures/etc. all
 * lost their live-fallback path in the migration off OddsPapi; only /api/ingest/poll
 * calls the odds API now).
 */
export async function listFixtures(input: ListFixturesInput) {
  try {
    const db = getDb();
    const sportKey = input.tournamentId;
    const conditions = [isNotNull(oddsCache.bookmakerOdds)];
    if (sportKey) conditions.push(eq(oddsCache.sportKey, sportKey));
    if (input.from) conditions.push(gte(oddsCache.commenceTime, new Date(input.from)));
    if (input.to) conditions.push(lte(oddsCache.commenceTime, new Date(input.to)));

    const rows = await db
      .select()
      .from(oddsCache)
      .where(and(...conditions));

    const fixtures: FixtureSummary[] = rows
      .map((r) => ({
        fixtureId: r.eventId,
        sportKey: r.sportKey,
        tournamentId: r.sportKey,
        homeTeam: r.homeTeam ?? undefined,
        awayTeam: r.awayTeam ?? undefined,
        startTime: (r.commenceTime ?? r.updatedAt).toISOString(),
        bookmakerOdds: (r.bookmakerOdds as BookmakerOdds) ?? undefined,
      }))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    return { fixtures, source: "cache" as const };
  } catch {
    return { fixtures: [] as FixtureSummary[], source: "cache" as const };
  }
}
