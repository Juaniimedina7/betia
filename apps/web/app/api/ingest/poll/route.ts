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

  // Poll independently from the sports-list refresh: a failure in one (e.g. OddsPapi
  // 500s on /v4/sports) shouldn't discard fixture odds the other already fetched and
  // cached via the onUpdate side effect above.
  const [pollOutcome, sportsOutcome] = await Promise.allSettled([source.poll(), client.listSports()]);

  let sportsPolled = 0;
  if (sportsOutcome.status === "fulfilled" && sportsOutcome.value.length > 0) {
    const sports = sportsOutcome.value;
    await db
      .insert(sportsCache)
      .values(sports.map((s) => ({ sportId: s.sportId, name: s.name })))
      .onConflictDoUpdate({
        target: sportsCache.sportId,
        set: { name: sql`excluded.name`, updatedAt: sql`now()` },
      });
    sportsPolled = sports.length;
  }

  const errors: Record<string, { message: string; status: number }> = {};
  for (const [key, outcome] of [
    ["fixtures", pollOutcome],
    ["sports", sportsOutcome],
  ] as const) {
    if (outcome.status === "rejected") {
      const err = outcome.reason;
      errors[key] = err instanceof OddsPapiError ? { message: err.message, status: err.status } : { message: String(err), status: 0 };
    }
  }

  const fixturesPolled = pollOutcome.status === "fulfilled" ? pollOutcome.value.fixturesPolled : 0;
  const hasErrors = Object.keys(errors).length > 0;
  const allFailed = pollOutcome.status === "rejected" && sportsOutcome.status === "rejected";

  return Response.json(
    { fixturesPolled, sportsPolled, ...(hasErrors && { errors }) },
    { status: allFailed ? 502 : 200 },
  );
}
