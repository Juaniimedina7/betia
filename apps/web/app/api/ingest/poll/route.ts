import { getDb, oddsCache, sportsCache } from "@bet/db";
import { getOddsPapiClient, OddsPapiError, RedisOddsCache, RestPollingSource } from "@bet/oddspapi-client";
import { sql } from "drizzle-orm";

const ODDS_CACHE_TTL_SECONDS = 120;
const DEFAULT_BOOKMAKER = "pinnacle";

function watchedTournamentIds(): string[] {
  return (process.env.WATCHED_TOURNAMENT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

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
    await cache.setFixtureOdds(event.fixtureId, event.bookmakerOdds, ODDS_CACHE_TTL_SECONDS);
    await db
      .insert(oddsCache)
      .values({ fixtureId: event.fixtureId, sportId: "", bookmakerOdds: event.bookmakerOdds })
      .onConflictDoUpdate({
        target: oddsCache.fixtureId,
        set: { bookmakerOdds: sql`excluded.bookmaker_odds`, updatedAt: sql`now()` },
      });
  });

  try {
    const [result, sports] = await Promise.all([source.poll(), client.listSports()]);

    if (sports.length > 0) {
      await db
        .insert(sportsCache)
        .values(sports.map((s) => ({ sportId: s.sportId, name: s.name })))
        .onConflictDoUpdate({
          target: sportsCache.sportId,
          set: { name: sql`excluded.name`, updatedAt: sql`now()` },
        });
    }

    return Response.json({ ...result, sportsPolled: sports.length });
  } catch (err) {
    if (err instanceof OddsPapiError) {
      return Response.json(
        { error: err.message, status: err.status },
        { status: err.status === 0 ? 504 : 502 },
      );
    }
    throw err;
  }
}
