import { getDb, oddsCache } from "@bet/db";
import { ApiFootballError, getApiFootballClient } from "@bet/api-football-client";
import { eq, sql } from "drizzle-orm";
import { API_FOOTBALL_LEAGUE_IDS, sportKeyForApiFootballLeague } from "@/lib/ingest/api-football-league-map";
import { matchFixture, type OddsCacheFixtureCandidate } from "@/lib/ingest/fixture-matching";

// Defensive cap on how many per-fixture /odds calls one run makes — a pathological day
// (e.g. a Champions League matchday with many simultaneous kickoffs across our watched
// competitions) shouldn't be able to blow the 100/day Free-plan budget in one run. See
// CLAUDE.md's "API-Football odds quota" section for the full math this is based on.
const MAX_FIXTURES_PER_RUN = 40;

const WATCHED_LEAGUE_IDS = new Set(Object.values(API_FOOTBALL_LEAGUE_IDS));

// This route must run AFTER /api/ingest/poll in the same cron job: it merges
// API-Football's odds into rows The Odds API already wrote for the same fixture
// (matched by team name + kickoff time, see fixture-matching.ts), and only falls back
// to inserting a new row when no match exists yet.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const client = getApiFootballClient();
  // Free-plan budget only covers "tomorrow" (1 day ahead) per the confirmed-live cost
  // math in CLAUDE.md — widening this window means redoing that math first.
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let watched;
  try {
    watched = await client.getOddsForLeagues(date, WATCHED_LEAGUE_IDS, MAX_FIXTURES_PER_RUN);
  } catch (err) {
    const error =
      err instanceof ApiFootballError
        ? { message: err.message, status: err.status, body: err.body.slice(0, 500) }
        : { message: String(err), status: 0 };
    return Response.json({ date, merged: 0, inserted: 0, errors: { odds: error } }, { status: 502 });
  }

  const db = getDb();
  // One odds_cache read per distinct watched sport_key this run, not per fixture.
  const candidatesBySportKey = new Map<string, OddsCacheFixtureCandidate[]>();

  let merged = 0;
  let inserted = 0;

  for (const fixture of watched) {
    const sportKey = sportKeyForApiFootballLeague(fixture.leagueId)!;
    if (!candidatesBySportKey.has(sportKey)) {
      const rows = await db
        .select({
          eventId: oddsCache.eventId,
          homeTeam: oddsCache.homeTeam,
          awayTeam: oddsCache.awayTeam,
          commenceTime: oddsCache.commenceTime,
        })
        .from(oddsCache)
        .where(eq(oddsCache.sportKey, sportKey));
      candidatesBySportKey.set(sportKey, rows);
    }
    const candidates = candidatesBySportKey.get(sportKey)!;
    const commenceTime = new Date(fixture.commenceTime);
    const matchedEventId = matchFixture(fixture.homeTeam, fixture.awayTeam, commenceTime, candidates);
    const bookmakerOddsJson = JSON.stringify(fixture.bookmakerOdds);

    if (matchedEventId) {
      // Plain UPDATE, not an upsert — no `excluded` alias available, so the merge
      // reads/writes the target row's own current value in one statement. The `||`
      // only overwrites the af:-namespaced keys this route owns; The Odds API's own
      // bookmaker keys (written by the separate /api/ingest/poll route) are untouched.
      await db
        .update(oddsCache)
        .set({
          bookmakerOdds: sql`bookmaker_odds || ${bookmakerOddsJson}::jsonb`,
          updatedAt: sql`now()`,
        })
        .where(eq(oddsCache.eventId, matchedEventId));
      merged++;
    } else {
      const syntheticEventId = `apifootball:${fixture.fixtureId}`;
      await db
        .insert(oddsCache)
        .values({
          eventId: syntheticEventId,
          sportKey,
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          commenceTime,
          bookmakerOdds: fixture.bookmakerOdds,
        })
        .onConflictDoUpdate({
          target: oddsCache.eventId,
          set: {
            bookmakerOdds: sql`odds_cache.bookmaker_odds || excluded.bookmaker_odds`,
            homeTeam: sql`excluded.home_team`,
            awayTeam: sql`excluded.away_team`,
            commenceTime: sql`excluded.commence_time`,
            updatedAt: sql`now()`,
          },
        });
      // So a later fixture in the same league this run can't also match this one.
      candidates.push({
        eventId: syntheticEventId,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        commenceTime,
      });
      inserted++;
    }
  }

  return Response.json({
    date,
    fixturesWithOdds: watched.length,
    merged,
    inserted,
    quota: client.getLastQuotaSnapshot(),
  });
}
