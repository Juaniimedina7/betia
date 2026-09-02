import { getDb, oddsCache, sportsCache } from "@bet/db";
import { getOddsApiClient, OddsApiError, RedisOddsCache, RestPollingSource } from "@bet/odds-api-client";
import { sql } from "drizzle-orm";
import { watchedSportKeys } from "@/lib/ingest/watched-sport-keys";

const ODDS_CACHE_TTL_SECONDS = 120;
// Pinnacle stays as the de-vig reference (sharp book, low vig). The rest were picked
// by hand (2026-09-02) from a live GET /v4/sports/{sport}/odds survey of all 66
// bookmakers The Odds API returns across the 16 watched leagues — bet365 isn't among
// them at all (confirmed live, licensing). Coverage isn't uniform across leagues (a
// given book can be missing from some of the 16), so build_combo's `bookmaker` filter
// may still come up empty for an off-coverage league/book combination even though the
// book is in this list. Adding/removing bookmakers here costs nothing extra in quota
// — The Odds API bills per market requested, not per bookmaker (see CLAUDE.md's "The
// Odds API quota" section) — but redo that section's budget math before changing the
// market list or the cron cadence.
const DEFAULT_BOOKMAKERS = ["pinnacle", "unibet", "betano_uk", "codere_it", "betsson", "betway", "espnbet"];
const MARKETS = ["h2h"];

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const client = getOddsApiClient();
  const cache = new RedisOddsCache();
  const bookmakers = (process.env.ODDSAPI_BOOKMAKERS || "")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
  const source = new RestPollingSource({
    client,
    watchedSportKeys,
    bookmakers: bookmakers.length > 0 ? bookmakers : DEFAULT_BOOKMAKERS,
    markets: MARKETS,
  });

  const db = getDb();
  source.onUpdate(async (event) => {
    // Independent, best-effort writes: Redis being unreachable/unconfigured
    // shouldn't stop the durable Postgres backup from getting this event's odds,
    // and vice versa.
    await Promise.allSettled([
      cache.setFixtureOdds(event.eventId, event.bookmakerOdds, ODDS_CACHE_TTL_SECONDS),
      db
        .insert(oddsCache)
        .values({
          eventId: event.eventId,
          sportKey: event.sportKey,
          sportTitle: event.sportTitle,
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          commenceTime: new Date(event.commenceTime),
          bookmakerOdds: event.bookmakerOdds,
        })
        .onConflictDoUpdate({
          target: oddsCache.eventId,
          set: {
            // Unlike OddsPapi, one GET /v4/sports/{sport}/odds call already returns
            // every requested bookmaker's odds for an event bundled together — there's
            // no longer a scenario where a second bookmaker's write needs to merge
            // into (rather than overwrite) the first's, since both land in one write.
            bookmakerOdds: sql`excluded.bookmaker_odds`,
            sportTitle: sql`excluded.sport_title`,
            homeTeam: sql`excluded.home_team`,
            awayTeam: sql`excluded.away_team`,
            commenceTime: sql`excluded.commence_time`,
            updatedAt: sql`now()`,
          },
        }),
    ]);
  });

  // Unlike the old OddsPapi cron, this route DOES refresh sports_cache every run:
  // nothing else writes it anymore (list_sports/list_tournaments lost their
  // live-fallback write path when they became DB-only), so this is now the only
  // place sports_cache gets populated.
  let sportsRefreshError: unknown;
  try {
    const sports = await client.listSports();
    if (sports.length > 0) {
      await db
        .insert(sportsCache)
        .values(sports.map((s) => ({ sportKey: s.sportKey, group: s.group, title: s.title, active: s.active ?? false })))
        .onConflictDoUpdate({
          target: sportsCache.sportKey,
          set: {
            group: sql`excluded.group`,
            title: sql`excluded.title`,
            active: sql`excluded.active`,
            updatedAt: sql`now()`,
          },
        });
    }
  } catch (err) {
    sportsRefreshError = err;
  }

  try {
    const { eventsPolled } = await source.poll();
    const quota = client.getLastQuotaSnapshot();
    return Response.json({
      eventsPolled,
      quota,
      errors: sportsRefreshError ? { sports: String(sportsRefreshError) } : undefined,
    });
  } catch (err) {
    const error =
      err instanceof OddsApiError
        ? { message: err.message, status: err.status, body: err.body.slice(0, 500) }
        : { message: String(err), status: 0 };
    return Response.json({ eventsPolled: 0, errors: { odds: error } }, { status: 502 });
  }
}
