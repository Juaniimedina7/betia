import { betSlips, getDb } from "@bet/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUserId, type ToolAuthContext } from "../context";

export const updateBetSlipOutcomeInput = z.object({
  betSlipId: z.string().uuid(),
  userMarkedOutcome: z.enum(["won", "lost", "void"]),
});

export type UpdateBetSlipOutcomeInput = z.infer<typeof updateBetSlipOutcomeInput>;

export async function updateBetSlipOutcome(
  input: UpdateBetSlipOutcomeInput,
  ctx: ToolAuthContext | undefined,
) {
  const userId = requireUserId(ctx, "update_bet_slip_outcome");
  const db = getDb();

  const statusMap = { won: "won", lost: "lost", void: "void" } as const;

  const [updated] = await db
    .update(betSlips)
    .set({
      userMarkedOutcome: input.userMarkedOutcome,
      status: statusMap[input.userMarkedOutcome],
      settledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(betSlips.id, input.betSlipId), eq(betSlips.userId, userId)))
    .returning({ id: betSlips.id, status: betSlips.status });

  if (!updated) {
    throw new Error("Bet slip not found or not owned by this user");
  }

  return { betSlipId: updated.id, status: updated.status };
}
