import type { BookmakerOdds, Event, OutcomeQuote } from "@bet/odds-api-client";
import type { CandidateLeg } from "./types";

const PINNACLE_KEYS = ["pinnacle", "pinnacle.com"];

function isUsable(outcome: OutcomeQuote | undefined): outcome is OutcomeQuote {
  return !!outcome && outcome.price > 1;
}

/** Composite key so a market that ever carries multiple lines for the same outcome
 * name (e.g. alternate totals) doesn't collide in the per-outcome price maps below. */
function outcomeKey(outcome: OutcomeQuote): string {
  return `${outcome.name}|${outcome.point ?? ""}`;
}

/**
 * Reference price per outcome within one market: Pinnacle's price if it quotes this
 * market (sharp book, low vig), otherwise the median price across all bookmakers
 * quoting that outcome. Returns an empty map for outcomes nobody prices (can't build
 * a fair reference).
 */
function referencePrices(bookmakerOdds: BookmakerOdds, marketId: string): Record<string, number> {
  const pinnacleKey = Object.keys(bookmakerOdds).find((k) => PINNACLE_KEYS.includes(k.toLowerCase()));
  const pinnacleMarket = pinnacleKey ? bookmakerOdds[pinnacleKey]?.markets[marketId] : undefined;

  if (pinnacleMarket) {
    const prices: Record<string, number> = {};
    for (const outcome of pinnacleMarket.outcomes) {
      if (isUsable(outcome)) prices[outcomeKey(outcome)] = outcome.price;
    }
    if (Object.keys(prices).length > 0) return prices;
  }

  // Fallback: median price per outcome across all bookmakers offering this market.
  const byOutcome: Record<string, number[]> = {};
  for (const book of Object.values(bookmakerOdds)) {
    const market = book.markets[marketId];
    if (!market) continue;
    for (const outcome of market.outcomes) {
      if (!isUsable(outcome)) continue;
      (byOutcome[outcomeKey(outcome)] ??= []).push(outcome.price);
    }
  }

  const medians: Record<string, number> = {};
  for (const [key, prices] of Object.entries(byOutcome)) {
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medians[key] = sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
  }
  return medians;
}

/** Multiplicative de-vig: normalizes implied probabilities so they sum to 1. */
function deVig(prices: Record<string, number>): Record<string, number> {
  const implied = Object.entries(prices).map(([key, price]) => [key, 1 / price] as const);
  const overround = implied.reduce((sum, [, p]) => sum + p, 0);
  if (overround <= 0) return {};
  return Object.fromEntries(implied.map(([key, p]) => [key, p / overround]));
}

/**
 * Best (highest) usable price for a specific outcome. Across all bookmakers by
 * default; restricted to a single one when `bookmakerFilter` is given (case-
 * insensitive key match) — used to force every leg onto one specific book instead of
 * shopping for the best price across the whole cached pool.
 */
function bestPrice(
  bookmakerOdds: BookmakerOdds,
  marketId: string,
  key: string,
  bookmakerFilter?: string,
): { bookmaker: string; outcome: OutcomeQuote } | undefined {
  let best: { bookmaker: string; outcome: OutcomeQuote } | undefined;
  for (const [bookmaker, book] of Object.entries(bookmakerOdds)) {
    if (bookmakerFilter && bookmaker.toLowerCase() !== bookmakerFilter.toLowerCase()) continue;
    const outcome = book.markets[marketId]?.outcomes.find((o) => isUsable(o) && outcomeKey(o) === key);
    if (!outcome) continue;
    if (!best || outcome.price > best.outcome.price) {
      best = { bookmaker, outcome };
    }
  }
  return best;
}

export interface ExtractCandidateLegsOptions {
  /**
   * Restrict the *bettable* price/outcome of every leg to this one bookmaker (case-
   * insensitive) — e.g. "the user wants every pick to be from bet365". The fair-price
   * reference (Pinnacle-or-median across the full cached pool) is NOT restricted, so
   * edge still reflects that book's price against the real sharp/consensus line, not
   * a self-devigged comparison against its own market. An event/market with no price
   * from this bookmaker is simply not a candidate.
   */
  bookmaker?: string;
}

/**
 * Flattens every event's bookmakerOdds into candidate legs with a fair-price
 * reference and edge. This is the only place raw odds get turned into something the
 * search algorithm can rank — no LLM involvement.
 */
export function extractCandidateLegs(events: Event[], options: ExtractCandidateLegsOptions = {}): CandidateLeg[] {
  const legs: CandidateLeg[] = [];

  for (const event of events) {
    if (Object.keys(event.bookmakerOdds).length === 0) continue;

    const marketIds = new Set<string>();
    for (const book of Object.values(event.bookmakerOdds)) {
      for (const marketId of Object.keys(book.markets)) marketIds.add(marketId);
    }

    for (const marketId of marketIds) {
      const refPrices = referencePrices(event.bookmakerOdds, marketId);
      const fairProbabilities = deVig(refPrices);

      for (const [key, fairProbability] of Object.entries(fairProbabilities)) {
        const best = bestPrice(event.bookmakerOdds, marketId, key, options.bookmaker);
        if (!best || fairProbability <= 0) continue;

        const fairPriceDecimal = 1 / fairProbability;
        const edgePct = (best.outcome.price * fairProbability - 1) * 100;
        // For h2h, the outcome name already IS the display label (a team name, or
        // "Draw") — no catalog lookup needed. For spreads/totals, append the line.
        const outcomeLabel =
          best.outcome.point !== undefined
            ? `${best.outcome.name} (${best.outcome.point > 0 ? "+" : ""}${best.outcome.point})`
            : best.outcome.name;

        legs.push({
          fixtureId: event.eventId,
          sportKey: event.sportKey,
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          startTime: event.commenceTime,
          marketId,
          outcomeName: best.outcome.name,
          point: best.outcome.point,
          selectionLabel: `${event.homeTeam} vs ${event.awayTeam} — ${outcomeLabel}`,
          bookmaker: best.bookmaker,
          priceDecimal: best.outcome.price,
          fairPriceDecimal,
          fairProbability,
          edgePct,
        });
      }
    }
  }

  return legs;
}
