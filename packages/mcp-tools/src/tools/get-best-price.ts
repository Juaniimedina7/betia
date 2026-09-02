import { getDb, oddsCache } from "@bet/db";
import type { Event } from "@bet/odds-api-client";
import { extractCandidateLegs } from "@bet/combo-engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
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

  const legs = extractCandidateLegs([event]).filter(
    (leg) => leg.marketId === input.marketId && leg.outcomeName === input.outcomeName && leg.point === input.point,
  );

  if (legs.length === 0) {
    return { found: false as const };
  }

  return {
    found: true as const,
    selections: legs.map((leg) => ({
      selectionLabel: leg.selectionLabel,
      bookmaker: leg.bookmaker,
      priceDecimal: leg.priceDecimal,
      fairPriceDecimal: leg.fairPriceDecimal,
      edgePct: leg.edgePct,
    })),
  };
}
