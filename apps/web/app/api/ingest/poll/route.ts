import { getDb, oddsCache } from "@bet/db";
import { getOddsPapiClient, OddsPapiError, RedisOddsCache, RestPollingSource } from "@bet/oddspapi-client";
import { sql } from "drizzle-orm";
import { watchedTournamentIds } from "@/lib/ingest/watched-tournaments";

const ODDS_CACHE_TTL_SECONDS = 120;
const DEFAULT_BOOKMAKER = "pinnacle";

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const client = getOddsPapiClient();
  const cache = new RedisOddsCache();
  const source = new RestPollingSource({
    client,
    watchedTournamentIds,
    bookmaker: process.env.ODDSPAPI_BOOKMAKER || DEFAULT_BOOKMAKER,
  });

  const db = getDb();
  source.onUpdate(async (event) => {
    // Independent, best-effort writes: Redis being unreachable/unconfigured
    // shouldn't stop the durable Postgres backup from getting this fixture's odds,
    // and vice versa.
    await Promise.allSettled([
      cache.setFixtureOdds(event.fixtureId, event.bookmakerOdds, ODDS_CACHE_TTL_SECONDS),
      db
        .insert(oddsCache)
        .values({ fixtureId: event.fixtureId, sportId: "", bookmakerOdds: event.bookmakerOdds })
        .onConflictDoUpdate({
          target: oddsCache.fixtureId,
          set: { bookmakerOdds: sql`excluded.bookmaker_odds`, updatedAt: sql`now()` },
        }),
    ]);
  });

  // The sports list is near-static reference data, refreshed for free whenever
  // a live UI request hits listSports() — not worth spending a monthly-quota
  // request on it here every run.
  try {
    const { fixturesPolled } = await source.poll();
    return Response.json({ fixturesPolled });
  } catch (err) {
    const error =
      err instanceof OddsPapiError
        ? { message: err.message, status: err.status, body: err.body.slice(0, 500) }
        : { message: String(err), status: 0 };
    return Response.json({ fixturesPolled: 0, errors: { fixtures: error } }, { status: 502 });
  }
}
