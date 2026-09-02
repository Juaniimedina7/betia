import { getDb, oddsCache } from "@bet/db";
import { RedisOddsCache, type BookmakerOdds } from "@bet/odds-api-client";
import { eq } from "drizzle-orm";
import { z } from "zod";
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
      },
    };
  } catch {
    return null;
  }
}
