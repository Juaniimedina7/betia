import { getDb, oddsCache } from "@bet/db";
import { ApiFootballError, getApiFootballClient } from "@bet/api-football-client";
import { eq, sql } from "drizzle-orm";
import { API_FOOTBALL_LEAGUE_IDS, sportKeyForApiFootballLeague } from "@/lib/ingest/api-football-league-map";
import { matchFixture, type OddsCacheFixtureCandidate } from "@/lib/ingest/fixture-matching";

// How many days ahead of today this route looks — widened from 1 to 7 (2026-09-08) so
// fixtures browsed on /odds show enriched markets well before their own "tomorrow",
// not only the single day right after each run. See CLAUDE.md's "API-Football odds
// quota" section for the budget math this and MAX_FIXTURES_PER_DAY are based on.
const DAYS_AHEAD = 7;

// Defensive per-day cap on how many per-fixture /odds calls one run makes — a
// pathological day (e.g. a Champions League matchday with many simultaneous kickoffs
// across our watched competitions) shouldn't be able to blow the 100/day Free-plan
// budget across the whole DAYS_AHEAD window in one run.
const MAX_FIXTURES_PER_DAY = 12;

const WATCHED_LEAGUE_IDS = new Set(Object.values(API_FOOTBALL_LEAGUE_IDS));

// Matches the team's Argentina-focused bookmaker policy (2026-09-07, see
// DEFAULT_BOOKMAKERS in apps/web/app/api/ingest/poll/route.ts) — Bet365 is the actual
// gap-filler (not on The Odds API at all) and 1xBet has real Argentina presence.
// API-Football has 33 possible bookmakers per its own /odds/bookmakers catalog; without
// this allowlist every one of them that has odds for a fixture would come through.
// Case-insensitive match against API-Football's own bookmaker `name` field.
//
// NOTE (2026-09-08): since soccer moved entirely to API-Football, these 2 bookmakers
// are now soccer's ENTIRE bookmaker set, not a complement to The Odds API's 7
// (pinnacle/unibet/betano_uk/codere_it/betsson/betway/espnbet) the way they used to
// be — soccer's price-comparison coverage genuinely shrank as a side effect of this
// migration. Widening this list is a separate, deliberate product decision — not done
// here — see CLAUDE.md.
const DEFAULT_API_FOOTBALL_BOOKMAKERS = ["bet365", "1xbet"];

// Since 2026-09-08 this is the ONLY source of soccer odds — The Odds API no longer
// polls any soccer sport_key at all (see watched-sport-keys.ts and CLAUDE.md's
// "eliminar The Odds API de futbol" section). The team-name/kickoff-time matching
// below (fixture-matching.ts) now mostly matches a fixture against a row this same
// route inserted on an earlier run (correctly folding repeated runs' bookmaker odds
// into one row per real-world fixture) rather than against a row The Odds API wrote —
// the insert branch only fires the first time a given fixture is seen. It's also a
// harmless no-op safety net for any pre-migration odds_cache row that hasn't expired
// yet (self-cleans via the hourly cleanup cron once its kickoff passes).
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const client = getApiFootballClient();
  const bookmakers = (process.env.API_FOOTBALL_BOOKMAKERS || "")
    .split(",")
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean);
  const allowedBookmakers = new Set(bookmakers.length > 0 ? bookmakers : DEFAULT_API_FOOTBALL_BOOKMAKERS);

  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) =>
    new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );

  const watched: Awaited<ReturnType<typeof client.getOddsForLeagues>> = [];
  const dayErrors: Record<string, unknown> = {};
  for (const date of dates) {
    try {
      const fixtures = await client.getOddsForLeagues(date, WATCHED_LEAGUE_IDS, MAX_FIXTURES_PER_DAY, allowedBookmakers);
      watched.push(...fixtures);
    } catch (err) {
      // One bad day (e.g. a transient timeout) shouldn't sink the other 6 — record it
      // and keep going, same "independent, best-effort" spirit as poll/route.ts.
      dayErrors[date] =
        err instanceof ApiFootballError
          ? { message: err.message, status: err.status, body: err.body.slice(0, 500) }
          : { message: String(err), status: 0 };
    }
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
    dates,
    fixturesWithOdds: watched.length,
    merged,
    inserted,
    errors: Object.keys(dayErrors).length > 0 ? dayErrors : undefined,
    quota: client.getLastQuotaSnapshot(),
  });
}
