import { getDb, marketCatalog, oddsCache } from "@bet/db";
import { getOddsPapiClient, RedisOddsCache, type BookmakerOdds } from "@bet/oddspapi-client";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { marketLabel, outcomeLabel } from "../market-labels";

export const getOddsInput = z.object({
  fixtureId: z.string(),
});

export type GetOddsInput = z.infer<typeof getOddsInput>;

const cache = new RedisOddsCache();

export interface Matchup {
  participant1Name?: string;
  participant2Name?: string;
  startTime?: string;
}

export interface MarketInfo {
  label: string;
  outcomes: Record<string, string>;
}

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
        marketCatalog: await buildMarketCatalog(context?.sportId, cached, context),
      };
    }
  } catch {
    // Redis not configured (e.g. local dev without Upstash) — fall through to a live fetch.
  }

  try {
    const fixture = await getOddsPapiClient().getOdds(input.fixtureId);
    const bookmakerOdds = fixture.bookmakerOdds ?? {};
    await cacheOdds(input.fixtureId, fixture.sportId, bookmakerOdds);
    let matchup = { participant1Name: fixture.participant1Name, participant2Name: fixture.participant2Name, startTime: fixture.startTime };
    if (!matchup.participant1Name || !matchup.participant2Name) {
      // /v4/odds (single-fixture) doesn't return participant names — fill them in from
      // whatever /odds/[sportId] already cached for this fixture, if anything.
      const context = await getFixtureContext(input.fixtureId);
      if (context?.participant1Name && context?.participant2Name) matchup = { ...matchup, ...context };
    }
    return {
      fixtureId: input.fixtureId,
      bookmakerOdds,
      source: "live" as const,
      cachedAt: undefined as string | undefined,
      matchup,
      marketCatalog: await buildMarketCatalog(fixture.sportId, bookmakerOdds, matchup),
    };
  } catch (liveError) {
    const backup = await readCachedOdds(input.fixtureId);
    if (backup?.bookmakerOdds) {
      return {
        fixtureId: input.fixtureId,
        bookmakerOdds: backup.bookmakerOdds,
        source: "db-cache" as const,
        cachedAt: backup.cachedAt,
        matchup: backup.matchup,
        marketCatalog: await buildMarketCatalog(backup.sportId, backup.bookmakerOdds, backup.matchup),
      };
    }
    // No odds anywhere (live down + never cached before), but we may still know who's playing.
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
    throw liveError;
  }
}

/** Builds { marketId: { label, outcomes: { outcomeId: label } } } for only the markets
 * actually present in this fixture's odds, joined against the market_catalog reference
 * table and translated to Spanish (see market-labels.ts). */
async function buildMarketCatalog(
  sportId: string | undefined,
  bookmakerOdds: BookmakerOdds,
  matchup: Matchup | undefined,
): Promise<Record<string, MarketInfo>> {
  if (!sportId) return {};
  const marketIds = new Set<string>();
  for (const bookmaker of Object.values(bookmakerOdds)) {
    for (const marketId of Object.keys(bookmaker.markets ?? {})) marketIds.add(marketId);
  }
  if (marketIds.size === 0) return {};

  try {
    const rows = await getDb()
      .select()
      .from(marketCatalog)
      .where(and(eq(marketCatalog.sportId, sportId), inArray(marketCatalog.marketId, [...marketIds])));

    const result: Record<string, MarketInfo> = {};
    for (const row of rows) {
      const outcomes: Record<string, string> = {};
      for (const o of row.outcomes as Array<{ outcomeId: string; outcomeName: string }>) {
        outcomes[o.outcomeId] = outcomeLabel(o.outcomeName, matchup?.participant1Name, matchup?.participant2Name);
      }
      result[row.marketId] = {
        label: marketLabel(row.marketType, row.marketName, Number(row.handicap ?? 0)),
        outcomes,
      };
    }
    return result;
  } catch {
    return {};
  }
}

async function getFixtureContext(fixtureId: string): Promise<(Matchup & { sportId?: string }) | undefined> {
  try {
    const [row] = await getDb().select().from(oddsCache).where(eq(oddsCache.fixtureId, fixtureId)).limit(1);
    if (!row) return undefined;
    return {
      sportId: row.sportId || undefined,
      participant1Name: row.participant1Name ?? undefined,
      participant2Name: row.participant2Name ?? undefined,
      startTime: row.startTime?.toISOString(),
    };
  } catch {
    return undefined;
  }
}

async function cacheOdds(fixtureId: string, sportId: string, bookmakerOdds: BookmakerOdds): Promise<void> {
  try {
    await getDb()
      .insert(oddsCache)
      .values({ fixtureId, sportId, bookmakerOdds })
      .onConflictDoUpdate({
        target: oddsCache.fixtureId,
        set: { sportId: sql`excluded.sport_id`, bookmakerOdds: sql`excluded.bookmaker_odds`, updatedAt: sql`now()` },
      });
  } catch {
    // Best-effort backup — a DB hiccup shouldn't break the live response.
  }
}

async function readCachedOdds(
  fixtureId: string,
): Promise<{ bookmakerOdds: BookmakerOdds | null; cachedAt: string; matchup: Matchup; sportId: string | undefined } | null> {
  try {
    const [row] = await getDb().select().from(oddsCache).where(eq(oddsCache.fixtureId, fixtureId)).limit(1);
    if (!row) return null;
    return {
      bookmakerOdds: (row.bookmakerOdds as BookmakerOdds | null) ?? null,
      cachedAt: row.updatedAt.toISOString(),
      sportId: row.sportId || undefined,
      matchup: {
        participant1Name: row.participant1Name ?? undefined,
        participant2Name: row.participant2Name ?? undefined,
        startTime: row.startTime?.toISOString(),
      },
    };
  } catch {
    return null;
  }
}
