import { getDb, oddsCache } from "@bet/db";
import { and, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type { FixtureSummary } from "./list-fixtures";

export const getOddsByTournamentInput = z.object({
  sportKeys: z.array(z.string()).min(1),
});

export type GetOddsByTournamentInput = z.infer<typeof getOddsByTournamentInput>;

/**
 * DB-only read of odds_cache scoped to a set of sport_keys — no live call, no
 * `bookmaker` param (cached rows already carry whichever bookmakers /api/ingest/poll
 * chose; there's nothing to filter to a single book here).
 */
export async function getOddsByTournament(input: GetOddsByTournamentInput) {
  const db = getDb();
  const rows = await db
    .select()
    .from(oddsCache)
    .where(and(inArray(oddsCache.sportKey, input.sportKeys), isNotNull(oddsCache.bookmakerOdds)));

  const fixtures: FixtureSummary[] = rows.map((r) => ({
    fixtureId: r.eventId,
    sportKey: r.sportKey,
    tournamentId: r.sportKey,
    homeTeam: r.homeTeam ?? undefined,
    awayTeam: r.awayTeam ?? undefined,
    startTime: (r.commenceTime ?? r.updatedAt).toISOString(),
    bookmakerOdds: r.bookmakerOdds as FixtureSummary["bookmakerOdds"],
  }));

  return { fixtures };
}
