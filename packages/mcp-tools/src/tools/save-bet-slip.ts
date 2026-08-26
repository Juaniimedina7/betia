import { betSlipLegs, betSlips, getDb } from "@bet/db";
import { z } from "zod";
import { requireUserId, type ToolAuthContext } from "../context";

const legSchema = z.object({
  fixtureId: z.string(),
  sportId: z.string(),
  tournamentId: z.string(),
  participant1Id: z.string(),
  participant2Id: z.string(),
  startTime: z.string(),
  marketId: z.string(),
  outcomeId: z.string(),
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

  await db.insert(betSlipLegs).values(
    input.legs.map((leg, index) => ({
      betSlipId: slip.id,
      legIndex: index,
      fixtureId: leg.fixtureId,
      sportId: leg.sportId,
      tournamentId: leg.tournamentId,
      participant1Id: leg.participant1Id,
      participant2Id: leg.participant2Id,
      startTime: new Date(leg.startTime),
      marketId: leg.marketId,
      outcomeId: leg.outcomeId,
      selectionLabel: leg.selectionLabel,
      bookmaker: leg.bookmaker,
      priceDecimal: leg.priceDecimal.toFixed(3),
      fairPriceDecimal: leg.fairPriceDecimal?.toFixed(3),
      edgePct: leg.edgePct?.toFixed(3),
    })),
  );

  return { betSlipId: slip.id, createdAt: slip.createdAt.toISOString() };
}
