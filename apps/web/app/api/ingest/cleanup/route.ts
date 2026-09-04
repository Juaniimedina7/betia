import { getDb, oddsCache } from "@bet/db";
import { RedisOddsCache } from "@bet/odds-api-client";
import { lt } from "drizzle-orm";

// Removes fixtures whose kickoff (commence_time) is already in the past from both the
// Postgres backup (odds_cache) and the Redis cache — the odds API only serves pregame
// h2h odds for upcoming events, so once a fixture's start time has passed there's
// nothing left to refresh for it. Redis entries already carry a 120s TTL and would
// self-expire regardless, but the explicit delete keeps both stores in sync immediately
// instead of relying on that TTL window.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = getDb();
  const cache = new RedisOddsCache();

  const expired = await db
    .delete(oddsCache)
    .where(lt(oddsCache.commenceTime, new Date()))
    .returning({ eventId: oddsCache.eventId });

  // Best-effort: a Redis miss/error here doesn't matter since those keys carry a
  // short TTL anyway (see comment above).
  await Promise.allSettled(expired.map((row) => cache.deleteFixtureOdds(row.eventId)));

  return Response.json({ deleted: expired.length });
}
