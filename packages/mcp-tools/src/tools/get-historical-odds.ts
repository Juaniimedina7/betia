import { getOddsPapiClient } from "@bet/oddspapi-client";
import { z } from "zod";
import { toUserFacingError } from "../user-facing-error";

export const getHistoricalOddsInput = z.object({
  fixtureId: z.string(),
  marketId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type GetHistoricalOddsInput = z.infer<typeof getHistoricalOddsInput>;

export async function getHistoricalOdds(input: GetHistoricalOddsInput) {
  try {
    const points = await getOddsPapiClient().getHistoricalOdds(input);
    return { points };
  } catch (liveError) {
    throw toUserFacingError(liveError);
  }
}
