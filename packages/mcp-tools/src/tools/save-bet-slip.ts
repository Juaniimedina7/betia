import { betSlipLegs, betSlips, getDb, oddsCache } from "@bet/db";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { requireUserId, type ToolAuthContext } from "../context";

const legSchema = z.object({
  fixtureId: z.string(),
  sportKey: z.string(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  startTime: z.string(),
  marketId: z.string(),
  outcomeName: z.string(),
  point: z.number().optional(),
  selectionLabel: z.string(),
  bookmaker: z.string(),
  priceDecimal: z.number(),
  fairPriceDecimal: z.number().optional(),
  edgePct: z.number().optional(),
});

export const saveBetSlipInput = z.object({
  legs: z.array(legSchema).min(1),
  title: z.string().optional(),
  reasoning: z.string().optional(),
  stakeReference: z.number().optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

export type SaveBetSlipInput = z.infer<typeof saveBetSlipInput>;

export async function saveBetSlip(input: SaveBetSlipInput, ctx: ToolAuthContext | undefined) {
  const userId = requireUserId(ctx, "save_bet_slip");
  const db = getDb();

  const combinedOdds = input.legs.reduce((product, leg) => product * leg.priceDecimal, 1);

  const [slip] = await db
    .insert(betSlips)
    .values({
      userId,
      title: input.title,
      status: "saved",
      combinedOddsDecimal: combinedOdds.toFixed(2),
      stakeReference: input.stakeReference?.toFixed(2),
      potentialPayout: input.stakeReference ? (input.stakeReference * combinedOdds).toFixed(2) : undefined,
      source: "agent",
      reasoning: input.reasoning,
      constraints: input.constraints,
    })
    .returning({ id: betSlips.id, createdAt: betSlips.createdAt });

  if (!slip) throw new Error("Failed to insert bet slip");

  const cachedOddsRows = await db
    .select({ eventId: oddsCache.eventId, bookmakerOdds: oddsCache.bookmakerOdds })
    .from(oddsCache)
    .where(inArray(oddsCache.eventId, input.legs.map((l) => l.fixtureId)));

  const oddsByEventId = new Map(cachedOddsRows.map((row) => [row.eventId, row.bookmakerOdds as Record<string, any>]));

  // bet_slip_legs keeps its OddsPapi-era column names (sportId/tournamentId/
  // participant1Id/participant2Id) as a point-in-time historical snapshot — the
  // provider migration didn't rename these columns (see CLAUDE.md), so new rows map
  // the closest new-model equivalents onto them: sportKey fills both sportId and
  // tournamentId (there's no separate tournament level anymore), and team name
  // strings fill the id columns (no stable participant id from this provider).
  await db.insert(betSlipLegs).values(
    input.legs.map((leg, index) => {
      let deepLink: string | undefined;
      const eventOdds = oddsByEventId.get(leg.fixtureId);
      if (eventOdds) {
        const bookmaker = eventOdds[leg.bookmaker];
        if (bookmaker) {
          const market = bookmaker.markets?.[leg.marketId];
          if (market) {
            const outcome = market.outcomes?.find((o: any) => o.name === leg.outcomeName);
            deepLink = outcome?.link ?? market.link;
          }
        }
      }

      return {
        betSlipId: slip.id,
        legIndex: index,
        fixtureId: leg.fixtureId,
        sportId: leg.sportKey,
        tournamentId: leg.sportKey,
        participant1Id: leg.homeTeam ?? "",
        participant2Id: leg.awayTeam ?? "",
        startTime: new Date(leg.startTime),
        marketId: leg.marketId,
        outcomeId: leg.point !== undefined ? `${leg.outcomeName}@${leg.point}` : leg.outcomeName,
        selectionLabel: leg.selectionLabel,
        bookmaker: leg.bookmaker,
        priceDecimal: leg.priceDecimal.toFixed(3),
        fairPriceDecimal: leg.fairPriceDecimal?.toFixed(3),
        edgePct: leg.edgePct?.toFixed(3),
        deepLink,
      };
    }),
  );

  return { betSlipId: slip.id, createdAt: slip.createdAt.toISOString() };
}
