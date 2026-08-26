import { betSlips, getDb } from "@bet/db";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { requireUserId, type ToolAuthContext } from "../context";

export const listUserBetSlipsInput = z.object({
  status: z.enum(["draft", "saved", "placed_by_user", "won", "lost", "void", "push"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export type ListUserBetSlipsInput = z.infer<typeof listUserBetSlipsInput>;

export async function listUserBetSlips(input: ListUserBetSlipsInput, ctx: ToolAuthContext | undefined) {
  const userId = requireUserId(ctx, "list_user_bet_slips");
  const db = getDb();
  const limit = input.limit ?? 20;

  const conditions = [eq(betSlips.userId, userId)];
  if (input.status) conditions.push(eq(betSlips.status, input.status));
  if (input.cursor) conditions.push(lt(betSlips.createdAt, new Date(input.cursor)));

  const rows = await db
    .select()
    .from(betSlips)
    .where(and(...conditions))
    .orderBy(desc(betSlips.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.createdAt.toISOString() : undefined;

  return { betSlips: page, nextCursor };
}
