import { betSlipLegs, betSlips, getDb } from "@bet/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUserId, type ToolAuthContext } from "../context";

export const getUserBetSlipInput = z.object({
  betSlipId: z.string().uuid(),
});

export type GetUserBetSlipInput = z.infer<typeof getUserBetSlipInput>;

export async function getUserBetSlip(input: GetUserBetSlipInput, ctx: ToolAuthContext | undefined) {
  const userId = requireUserId(ctx, "get_user_bet_slip");
  const db = getDb();

  const [slip] = await db
    .select()
    .from(betSlips)
    .where(and(eq(betSlips.id, input.betSlipId), eq(betSlips.userId, userId)))
    .limit(1);

  if (!slip) return { betSlip: null, legs: [] };

  const legs = await db
    .select()
    .from(betSlipLegs)
    .where(eq(betSlipLegs.betSlipId, slip.id))
    .orderBy(asc(betSlipLegs.legIndex));

  return { betSlip: slip, legs };
}
