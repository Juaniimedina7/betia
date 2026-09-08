import { getDb, oddsCache } from "@bet/db";
import { RedisOddsCache, type BookmakerOdds, type BookmakerQuote } from "@bet/odds-api-client";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hasFixtureStarted } from "../fixture-time";
import { marketLabel, outcomeLabel } from "../market-labels";

export const getOddsInput = z.object({
  fixtureId: z.string(),
});

export type GetOddsInput = z.infer<typeof getOddsInput>;

const cache = new RedisOddsCache();

export interface Matchup {
  homeTeam?: string;
  awayTeam?: string;
  startTime?: string;
  // True once the fixture's kickoff has already passed — odds_cache has no separate
  // status column, and the hourly cleanup cron (/api/ingest/cleanup) can take up to an
  // hour to actually delete a started fixture, so this is the caller's signal to treat
  // the odds as possibly stale/no-longer-bettable rather than assume they're live.
  hasStarted?: boolean;
}

export interface MarketInfo {
  label: string;
  outcomes: Record<string, string>;
}

/**
 * 2-tier read: Redis (fast, 120s TTL) then Postgres (durable backup). No live call —
 * only /api/ingest/poll writes either of these; this tool is read-only.
 */
export async function getOdds(input: GetOddsInput) {
  try {
    const cached = await cache.getFixtureOdds(input.fixtureId);
    if (cached) {
      const context = await getFixtureContext(input.fixtureId);
      return {
        fixtureId: input.fixtureId,
        bookmakerOdds: cached,
        source: "redis" as const,
        cachedAt: undefined as string | undefined,
        matchup: context,
        marketCatalog: buildMarketCatalog(cached, context),
      };
    }
  } catch {
    // Redis not configured (e.g. local dev without Upstash) — fall through to Postgres.
  }

  const backup = await readCachedOdds(input.fixtureId);
  if (backup?.bookmakerOdds) {
    return {
      fixtureId: input.fixtureId,
      bookmakerOdds: backup.bookmakerOdds,
      source: "db-cache" as const,
      cachedAt: backup.cachedAt,
      matchup: backup.matchup,
      marketCatalog: buildMarketCatalog(backup.bookmakerOdds, backup.matchup),
    };
  }
  if (backup?.matchup) {
    return {
      fixtureId: input.fixtureId,
      bookmakerOdds: {} as BookmakerOdds,
      source: "no-odds" as const,
      cachedAt: backup.cachedAt,
      matchup: backup.matchup,
      marketCatalog: {} as Record<string, MarketInfo>,
    };
  }
  return {
    fixtureId: input.fixtureId,
    bookmakerOdds: {} as BookmakerOdds,
    source: "no-odds" as const,
    cachedAt: undefined as string | undefined,
    matchup: undefined as Matchup | undefined,
    marketCatalog: {} as Record<string, MarketInfo>,
  };
}

/** Builds { marketKey: { label, outcomes: { outcomeName: label } } } for only the
 * markets actually present in this fixture's odds, from the static label map (there's
 * no queryable market catalog on this provider — see market-labels.ts). */
function buildMarketCatalog(bookmakerOdds: BookmakerOdds, _matchup: Matchup | undefined): Record<string, MarketInfo> {
  const result: Record<string, MarketInfo> = {};
  for (const book of Object.values(bookmakerOdds)) {
    for (const [marketKey, market] of Object.entries(book.markets)) {
      const outcomes: Record<string, string> = result[marketKey]?.outcomes ?? {};
      for (const outcome of market.outcomes) {
        outcomes[outcome.name] = outcomeLabel(outcome.name, outcome.point);
      }
      result[marketKey] = { label: marketLabel(marketKey), outcomes };
    }
  }
  return result;
}

async function getFixtureContext(fixtureId: string): Promise<Matchup | undefined> {
  try {
    const [row] = await getDb().select().from(oddsCache).where(eq(oddsCache.eventId, fixtureId)).limit(1);
    if (!row) return undefined;
    return {
      homeTeam: row.homeTeam ?? undefined,
      awayTeam: row.awayTeam ?? undefined,
      startTime: row.commenceTime?.toISOString(),
      hasStarted: hasFixtureStarted(row.commenceTime, row.updatedAt),
    };
  } catch {
    return undefined;
  }
}

async function readCachedOdds(
  fixtureId: string,
): Promise<{ bookmakerOdds: BookmakerOdds | null; cachedAt: string; matchup: Matchup } | null> {
  try {
    const [row] = await getDb().select().from(oddsCache).where(eq(oddsCache.eventId, fixtureId)).limit(1);
    if (!row) return null;
    return {
      bookmakerOdds: (row.bookmakerOdds as BookmakerOdds | null) ?? null,
      cachedAt: row.updatedAt.toISOString(),
      matchup: {
        homeTeam: row.homeTeam ?? undefined,
        awayTeam: row.awayTeam ?? undefined,
        startTime: row.commenceTime?.toISOString(),
        hasStarted: hasFixtureStarted(row.commenceTime, row.updatedAt),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Trims a getOdds() result down to markets that have a real curated Spanish label
 * (marketLabel() falls back to the raw key otherwise, so `label !== marketId` means
 * "we bothered to support this one"). Used only by the `get_odds` MCP tool exposed to
 * the agent — the `/fixtures/[fixtureId]` page calls getOdds() directly (untrimmed)
 * since its LiveOddsTable is built to browse every market via a dropdown.
 *
 * Exists because API-Football alone can put 150+ markets on one fixture — sending all
 * of that to the model on every get_odds call is expensive and, confirmed live
 * 2026-09-08, produced an unusably huge chat response for a request about one specific
 * market. See apps/web/components/agent-cards/odds-card.tsx for the matching UI-side
 * cap (kept as a second, independent safeguard).
 */
export function toCuratedOddsOutput<T extends { bookmakerOdds: BookmakerOdds; marketCatalog: Record<string, MarketInfo> }>(
  result: T,
): T {
  const curatedMarketIds = new Set(
    Object.entries(result.marketCatalog)
      .filter(([marketId, market]) => market.label !== marketId)
      .map(([marketId]) => marketId),
  );

  const marketCatalog: Record<string, MarketInfo> = {};
  for (const id of curatedMarketIds) marketCatalog[id] = result.marketCatalog[id]!;

  const bookmakerOdds: BookmakerOdds = {};
  for (const [bookmakerKey, book] of Object.entries(result.bookmakerOdds)) {
    const markets: BookmakerQuote["markets"] = {};
    for (const id of curatedMarketIds) {
      if (book.markets[id]) markets[id] = book.markets[id]!;
    }
    bookmakerOdds[bookmakerKey] = { ...book, markets };
  }

  return { ...result, bookmakerOdds, marketCatalog };
}
