import { getDb, oddsCache } from "@bet/db";
import type { BookmakerOdds } from "@bet/odds-api-client";
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { notStartedCondition } from "../fixture-time";
import { resolveByName } from "../fuzzy-match";

export const listFixturesInput = z.object({
  // Actually a sport_key (e.g. "soccer_epl") — kept as `tournamentId` to match
  // list_tournaments' output field without renaming call sites. `sportId` (a group
  // like "Soccer") has no matching column on odds_cache, so it's accepted but ignored.
  sportId: z.string().optional(),
  tournamentId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  // Fuzzy-matches (case/accent-insensitive, exact then substring either way — see
  // resolveByName) against either team's name. Deliberately independent of
  // sportId/tournamentId (like find_player_props' playerName) — a specific team name is
  // already a strong filter, so a user naming a match by its two teams ("Boca vs San
  // Pablo") doesn't need to resolve a sport/competition first just to find the fixture.
  teamName: z.string().optional(),
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
 * calls the odds API now). Always excludes fixtures whose kickoff has already passed
 * (see notStartedCondition in ../fixture-time) — from/to only narrow the future window
 * further, they never pull in an already-started match.
 */
export async function listFixtures(input: ListFixturesInput) {
  try {
    const db = getDb();
    const sportKey = input.tournamentId;
    const conditions = [isNotNull(oddsCache.bookmakerOdds), notStartedCondition()];
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
      .filter((f) => {
        if (!input.teamName) return true;
        const candidates = [f.homeTeam, f.awayTeam].filter((t): t is string => !!t);
        if (resolveByName(input.teamName, candidates) !== undefined) return true;
        // A caller may pass both teams in one phrase ("Boca San Pablo") instead of
        // one name at a time — retry per word so that still narrows correctly
        // instead of falsely reporting nothing cached.
        const words = input.teamName.split(/\s+/).filter((w) => w.length > 2);
        return words.some((w) => resolveByName(w, candidates) !== undefined);
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    return { fixtures, count: fixtures.length, source: "cache" as const };
  } catch {
    return { fixtures: [] as FixtureSummary[], count: 0, source: "cache" as const };
  }
}
