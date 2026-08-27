import { getDb, oddsCache } from "@bet/db";
import { getOddsPapiClient, RedisOddsCache, type BookmakerOdds } from "@bet/oddspapi-client";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

export const getOddsInput = z.object({
  fixtureId: z.string(),
});

export type GetOddsInput = z.infer<typeof getOddsInput>;

const cache = new RedisOddsCache();

export async function getOdds(input: GetOddsInput) {
  try {
    const cached = await cache.getFixtureOdds(input.fixtureId);
    if (cached) {
      return { fixtureId: input.fixtureId, bookmakerOdds: cached, source: "redis" as const, cachedAt: undefined as string | undefined };
    }
  } catch {
    // Redis not configured (e.g. local dev without Upstash) — fall through to a live fetch.
  }

  try {
    const fixture = await getOddsPapiClient().getOdds(input.fixtureId);
    const bookmakerOdds = fixture.bookmakerOdds ?? {};
    await cacheOdds(input.fixtureId, bookmakerOdds);
    return { fixtureId: input.fixtureId, bookmakerOdds, source: "live" as const, cachedAt: undefined as string | undefined };
  } catch (liveError) {
    const backup = await readCachedOdds(input.fixtureId);
    if (backup) {
      return { fixtureId: input.fixtureId, bookmakerOdds: backup.bookmakerOdds, source: "db-cache" as const, cachedAt: backup.cachedAt };
    }
    throw liveError;
  }
}

async function cacheOdds(fixtureId: string, bookmakerOdds: BookmakerOdds): Promise<void> {
  try {
    await getDb()
      .insert(oddsCache)
      .values({ fixtureId, sportId: "", bookmakerOdds })
      .onConflictDoUpdate({
        target: oddsCache.fixtureId,
        set: { bookmakerOdds: sql`excluded.bookmaker_odds`, updatedAt: sql`now()` },
      });
  } catch {
    // Best-effort backup — a DB hiccup shouldn't break the live response.
  }
}

async function readCachedOdds(
  fixtureId: string,
): Promise<{ bookmakerOdds: BookmakerOdds; cachedAt: string } | null> {
  try {
    const [row] = await getDb().select().from(oddsCache).where(eq(oddsCache.fixtureId, fixtureId)).limit(1);
    if (!row || !row.bookmakerOdds) return null;
    return { bookmakerOdds: row.bookmakerOdds as BookmakerOdds, cachedAt: row.updatedAt.toISOString() };
  } catch {
    return null;
  }
}
