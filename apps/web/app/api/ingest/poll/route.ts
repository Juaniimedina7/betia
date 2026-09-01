import { getDb, oddsCache } from "@bet/db";
import { getOddsPapiClient, OddsPapiError, RedisOddsCache, RestPollingSource } from "@bet/oddspapi-client";
import { sql } from "drizzle-orm";
import { watchedTournamentIds } from "@/lib/ingest/watched-tournaments";

const ODDS_CACHE_TTL_SECONDS = 120;
// build_combo (via odds_cache) needs at least two books to compute edge — Pinnacle
// as the de-vig reference plus one more to compare against. Redo the request budget
// math in CLAUDE.md's "OddsPapi quota" section before changing this list or cadence.
const DEFAULT_BOOKMAKERS = ["pinnacle", "bet365"];

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const client = getOddsPapiClient();
  const cache = new RedisOddsCache();
  const bookmakers = (process.env.ODDSPAPI_BOOKMAKERS || "")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
  const source = new RestPollingSource({
    client,
    watchedTournamentIds,
    bookmakers: bookmakers.length > 0 ? bookmakers : DEFAULT_BOOKMAKERS,
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
        .values({
          fixtureId: event.fixtureId,
          sportId: event.sportId,
          tournamentId: event.tournamentId,
          participant1Id: event.participant1Id,
          participant2Id: event.participant2Id,
          participant1Name: event.participant1Name,
          participant2Name: event.participant2Name,
          startTime: event.startTime ? new Date(event.startTime) : undefined,
          statusId: event.statusId,
          bookmakerOdds: event.bookmakerOdds,
        })
        .onConflictDoUpdate({
          target: oddsCache.fixtureId,
          set: {
            // Polling multiple bookmakers means multiple events land for the same
            // fixture (one per book) — merge into the existing JSON instead of
            // overwriting, or each book's write would clobber the last one's.
            bookmakerOdds: sql`coalesce(${oddsCache.bookmakerOdds}, '{}'::jsonb) || excluded.bookmaker_odds`,
            sportId: sql`excluded.sport_id`,
            tournamentId: sql`excluded.tournament_id`,
            participant1Id: sql`excluded.participant1_id`,
            participant2Id: sql`excluded.participant2_id`,
            participant1Name: sql`excluded.participant1_name`,
            participant2Name: sql`excluded.participant2_name`,
            startTime: sql`excluded.start_time`,
            statusId: sql`excluded.status_id`,
            updatedAt: sql`now()`,
          },
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
