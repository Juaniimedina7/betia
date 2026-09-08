import { getDb, oddsCache } from "@bet/db";
import type { Event } from "@bet/odds-api-client";
import { extractCandidateLegs } from "@bet/combo-engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hasFixtureStarted } from "../fixture-time";
import { resolveByName } from "../fuzzy-match";
import { toUserFacingError } from "../user-facing-error";

export const getBestPriceInput = z.object({
  fixtureId: z.string(),
  marketId: z.string(),
  outcomeName: z.string(),
  point: z.number().optional(),
});

export type GetBestPriceInput = z.infer<typeof getBestPriceInput>;

/** DB-only read of one odds_cache row — no live call. */
export async function getBestPrice(input: GetBestPriceInput) {
  let row: typeof oddsCache.$inferSelect | undefined;
  try {
    [row] = await getDb().select().from(oddsCache).where(eq(oddsCache.eventId, input.fixtureId)).limit(1);
  } catch (err) {
    throw toUserFacingError(err);
  }

  if (!row?.bookmakerOdds) {
    return { found: false as const };
  }

  const event: Event = {
    eventId: row.eventId,
    sportKey: row.sportKey,
    sportTitle: row.sportTitle ?? undefined,
    commenceTime: (row.commenceTime ?? row.updatedAt).toISOString(),
    homeTeam: row.homeTeam ?? "",
    awayTeam: row.awayTeam ?? "",
    bookmakerOdds: row.bookmakerOdds as Event["bookmakerOdds"],
  };

  // outcomeName resolution is fuzzy (exact case-insensitive, then substring) since
  // player-prop outcome names (e.g. "Lamine Yamal") come through raw/unnormalized from
  // API-Football — see packages/api-football-client's normalizeBookmakers, which only
  // translates "Match Winner" outcomes. Scoped to this market+point's own outcome
  // names first, so a fuzzy match never accidentally resolves against an unrelated
  // market's outcome.
  const legsForMarket = extractCandidateLegs([event]).filter(
    (leg) => leg.marketId === input.marketId && leg.point === input.point,
  );
  const resolvedOutcomeName = resolveByName(
    input.outcomeName,
    [...new Set(legsForMarket.map((leg) => leg.outcomeName))],
  );
  const legs = resolvedOutcomeName
    ? legsForMarket.filter((leg) => leg.outcomeName === resolvedOutcomeName)
    : [];

  if (legs.length === 0) {
    return { found: false as const };
  }

  return {
    found: true as const,
    // See Matchup.hasStarted in get-odds.ts for why this matters — no status column on
    // odds_cache, and the hourly cleanup cron can lag up to an hour behind kickoff.
    hasStarted: hasFixtureStarted(row.commenceTime, row.updatedAt),
    selections: legs.map((leg) => ({
      selectionLabel: leg.selectionLabel,
      bookmaker: leg.bookmaker,
      priceDecimal: leg.priceDecimal,
      fairPriceDecimal: leg.fairPriceDecimal,
      edgePct: leg.edgePct,
      deepLink: leg.deepLink,
    })),
  };
}
