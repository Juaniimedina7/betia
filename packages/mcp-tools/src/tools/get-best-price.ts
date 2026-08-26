import { getOddsPapiClient } from "@bet/oddspapi-client";
import { extractCandidateLegs } from "@bet/combo-engine";
import { z } from "zod";

export const getBestPriceInput = z.object({
  fixtureId: z.string(),
  marketId: z.string(),
  outcomeId: z.string(),
});

export type GetBestPriceInput = z.infer<typeof getBestPriceInput>;

export async function getBestPrice(input: GetBestPriceInput) {
  const fixture = await getOddsPapiClient().getOdds(input.fixtureId);
  const legs = extractCandidateLegs([fixture]).filter(
    (leg) => leg.marketId === input.marketId && leg.outcomeId === input.outcomeId,
  );

  if (legs.length === 0) {
    return { found: false as const };
  }

  return {
    found: true as const,
    selections: legs.map((leg) => ({
      playerIdx: leg.playerIdx,
      selectionLabel: leg.selectionLabel,
      bookmaker: leg.bookmaker,
      priceDecimal: leg.priceDecimal,
      fairPriceDecimal: leg.fairPriceDecimal,
      edgePct: leg.edgePct,
    })),
  };
}
