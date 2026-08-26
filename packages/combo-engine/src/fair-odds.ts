import type { Fixture, Outcome, OutcomePlayer } from "@bet/oddspapi-client";
import type { CandidateLeg } from "./types";

const PINNACLE_KEYS = ["pinnacle", "pinnacle.com"];

function isUsable(player: OutcomePlayer | undefined): player is OutcomePlayer {
  return !!player && player.active !== false && player.price > 1 && (player.limit ?? 1) > 0;
}

/**
 * Reference price per player selection within one outcome: Pinnacle's price if
 * it quotes this outcome (sharp book, low vig), otherwise the median price
 * across all bookmakers quoting that player. Returns null for players nobody
 * prices (can't build a fair reference).
 */
function referencePrices(
  bookmakerOdds: Fixture["bookmakerOdds"],
  marketId: string,
  outcomeId: string,
): Record<string, number> {
  if (!bookmakerOdds) return {};

  const pinnacleKey = Object.keys(bookmakerOdds).find((k) =>
    PINNACLE_KEYS.includes(k.toLowerCase()),
  );
  const pinnacleOutcome = pinnacleKey
    ? bookmakerOdds[pinnacleKey]?.markets[marketId]?.outcomes[outcomeId]
    : undefined;

  if (pinnacleOutcome) {
    const prices: Record<string, number> = {};
    for (const [playerIdx, player] of Object.entries(pinnacleOutcome.players)) {
      if (isUsable(player)) prices[playerIdx] = player.price;
    }
    if (Object.keys(prices).length > 0) return prices;
  }

  // Fallback: median price per player across all bookmakers offering this outcome.
  const byPlayer: Record<string, number[]> = {};
  for (const book of Object.values(bookmakerOdds)) {
    const outcome: Outcome | undefined = book.markets[marketId]?.outcomes[outcomeId];
    if (!outcome) continue;
    for (const [playerIdx, player] of Object.entries(outcome.players)) {
      if (!isUsable(player)) continue;
      (byPlayer[playerIdx] ??= []).push(player.price);
    }
  }

  const medians: Record<string, number> = {};
  for (const [playerIdx, prices] of Object.entries(byPlayer)) {
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medians[playerIdx] =
      sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  }
  return medians;
}

/** Multiplicative de-vig: normalizes implied probabilities so they sum to 1. */
function deVig(prices: Record<string, number>): Record<string, number> {
  const implied = Object.entries(prices).map(([playerIdx, price]) => [playerIdx, 1 / price] as const);
  const overround = implied.reduce((sum, [, p]) => sum + p, 0);
  if (overround <= 0) return {};
  return Object.fromEntries(implied.map(([playerIdx, p]) => [playerIdx, p / overround]));
}

/** Best (highest) active price for a specific player selection, across all bookmakers. */
function bestPrice(
  bookmakerOdds: Fixture["bookmakerOdds"],
  marketId: string,
  outcomeId: string,
  playerIdx: string,
): { bookmaker: string; price: number } | undefined {
  if (!bookmakerOdds) return undefined;
  let best: { bookmaker: string; price: number } | undefined;
  for (const [bookmaker, book] of Object.entries(bookmakerOdds)) {
    const player = book.markets[marketId]?.outcomes[outcomeId]?.players[playerIdx];
    if (!isUsable(player)) continue;
    if (!best || player.price > best.price) {
      best = { bookmaker, price: player.price };
    }
  }
  return best;
}

/**
 * Flattens every fixture's bookmakerOdds into candidate legs with a fair-price
 * reference and edge. This is the only place raw OddsPapi odds get turned into
 * something the search algorithm can rank — no LLM involvement.
 */
export function extractCandidateLegs(fixtures: Fixture[]): CandidateLeg[] {
  const legs: CandidateLeg[] = [];

  for (const fixture of fixtures) {
    if (!fixture.bookmakerOdds) continue;

    const marketIds = new Set<string>();
    for (const book of Object.values(fixture.bookmakerOdds)) {
      for (const marketId of Object.keys(book.markets)) marketIds.add(marketId);
    }

    for (const marketId of marketIds) {
      const outcomeIds = new Set<string>();
      for (const book of Object.values(fixture.bookmakerOdds)) {
        const market = book.markets[marketId];
        if (market) for (const outcomeId of Object.keys(market.outcomes)) outcomeIds.add(outcomeId);
      }

      for (const outcomeId of outcomeIds) {
        const refPrices = referencePrices(fixture.bookmakerOdds, marketId, outcomeId);
        const fairProbabilities = deVig(refPrices);

        for (const [playerIdx, fairProbability] of Object.entries(fairProbabilities)) {
          const best = bestPrice(fixture.bookmakerOdds, marketId, outcomeId, playerIdx);
          if (!best || fairProbability <= 0) continue;

          const fairPriceDecimal = 1 / fairProbability;
          const edgePct = (best.price * fairProbability - 1) * 100;

          legs.push({
            fixtureId: fixture.fixtureId,
            sportId: fixture.sportId,
            tournamentId: fixture.tournamentId,
            participant1Id: fixture.participant1Id,
            participant2Id: fixture.participant2Id,
            participant1Name: fixture.participant1Name,
            participant2Name: fixture.participant2Name,
            startTime: fixture.startTime,
            marketId,
            outcomeId,
            playerIdx,
            selectionLabel: `${fixture.participant1Name ?? fixture.participant1Id} vs ${
              fixture.participant2Name ?? fixture.participant2Id
            } — market ${marketId} / ${playerIdx}`,
            bookmaker: best.bookmaker,
            priceDecimal: best.price,
            fairPriceDecimal,
            fairProbability,
            edgePct,
          });
        }
      }
    }
  }

  return legs;
}
