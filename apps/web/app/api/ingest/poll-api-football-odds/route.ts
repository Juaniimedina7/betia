import { getDb, oddsCache } from "@bet/db";
import { ApiFootballError, getApiFootballClient } from "@bet/api-football-client";
import { eq, sql } from "drizzle-orm";
import { API_FOOTBALL_LEAGUE_IDS, sportKeyForApiFootballLeague } from "@/lib/ingest/api-football-league-map";
import { matchFixture, type OddsCacheFixtureCandidate } from "@/lib/ingest/fixture-matching";

// How many days ahead of today this route looks. Confirmed live 2026-09-10: the Free
// plan rejects `GET /fixtures?date=` for any date more than ~1 day out with
// `errors.plan: "Free plans do not have access to this date, try from <today-1> to
// <today+1>"` — a genuinely different (and narrower) restriction than the
// current-season-only block on league+season-scoped endpoints documented elsewhere in
// this client. That's what forced DAYS_AHEAD down to 1 for a few hours the same day
// (commit 1e3e541) — with it at 7, 6 of the 7 requested dates came back rejected every
// run, and findFixturesByDate silently treated a rejected date as "0 fixtures that day"
// (now fixed: it throws, surfaced through this route's per-day `dayErrors`, see the
// loop below).
//
// Raised to 5 the same day once the account holder committed to upgrading to the Pro
// plan ($19/mo, see CLAUDE.md) specifically to lift this — **not yet confirmed live
// against a Pro-plan key**. Until the upgrade actually lands, every date beyond
// `<today+1>` will keep coming back as an `errors.plan` rejection in `dayErrors` (a
// visible failure, not silent data loss — build_combo/get_best_price still fall back to
// whatever's already cached for those fixtures), and 5 rather than 7 keeps the
// worst-case request count under the Free plan's 100/day cap in the meantime (see
// MAX_FIXTURES_PER_DAY below) instead of relying entirely on the date-window rejections
// to hold the number down. Re-verify live the day the account actually moves to Pro:
// confirm the rejection is really gone for `<today+2>` onward, not just that quota went
// up — the Free-plan docs never mentioned this date window either, so don't assume
// Pro's docs are complete here.
const DAYS_AHEAD = 5;

// Defensive per-day cap on how many per-fixture /odds calls one run makes — a
// pathological day (e.g. a Champions League matchday with many simultaneous kickoffs
// across our watched competitions) shouldn't be able to blow the daily budget in one
// run. Confirmed live 2026-09-10 against a single real day: only 9 fixtures across all
// 13 watched leagues combined, well under this cap. Worst case at DAYS_AHEAD=5, 1
// run/day: 1 x 5 x (1 discovery + 12 fixtures) = 65 requests/day — under the Free plan's
// 100/day cap even before the date-window rejections above kick in (those rejections
// make the realistic Free-plan cost far lower still); comfortably under the Pro plan's
// 7,500/day once that upgrade is live. Redo this math before raising DAYS_AHEAD or this
// cap further.
const MAX_FIXTURES_PER_DAY = 12;

const WATCHED_LEAGUE_IDS = new Set(Object.values(API_FOOTBALL_LEAGUE_IDS));

// Matches the team's Argentina-focused bookmaker policy (2026-09-07, see
// DEFAULT_BOOKMAKERS in apps/web/app/api/ingest/poll/route.ts) — Bet365 is the actual
// gap-filler (not on The Odds API at all) and 1xBet has real Argentina presence.
// API-Football has 33 possible bookmakers per its own /odds/bookmakers catalog; without
// this allowlist every one of them that has odds for a fixture would come through.
// Case-insensitive match against API-Football's own bookmaker `name` field.
//
// NOTE (2026-09-08): since soccer moved entirely to API-Football, these bookmakers
// are now soccer's ENTIRE bookmaker set, not a complement to The Odds API's 7
// (pinnacle/unibet/betano_uk/codere_it/betsson/betway/espnbet) the way they used to
// be — soccer's price-comparison coverage genuinely shrank as a side effect of that
// migration. Betano and Betsson were added back on 2026-09-08 — API-Football mints
// them as af:betano/af:betsson (see bookmakerKeyFor in packages/api-football-client),
// distinct from The Odds API's unprefixed betano_uk/betsson keys, so
// apps/web/lib/bookmaker-links.ts needed new entries for the af: forms too. Coverage
// per fixture isn't guaranteed for either (see CLAUDE.md's "coverage isn't uniform"
// caveat), so a fixture with neither posted is unaffected.
// "pinnacle" added 2026-09-10 — NOT a bettable addition (Pinnacle isn't offered to this
// platform's Argentina-focused users). It exists purely so combo-engine's de-vig math
// has a sharp, low-vig reference for soccer again — since this migration, the only
// other bookmakers here are retail books, and a median across a handful of those
// doesn't recover a fair price (confirmed live: every outcome of a real match came back
// meaningfully negative-edge against a retail-only median). `REFERENCE_ONLY_BOOKMAKER_KEYS`
// in packages/combo-engine/src/fair-odds.ts keeps `af:pinnacle` out of `bestPrice`
// (never selectable as the actual leg price) and get-odds.ts strips it from anything
// shown to the website/agent — it only ever feeds the reference-price calculation.
const DEFAULT_API_FOOTBALL_BOOKMAKERS = ["bet365", "1xbet", "betano", "betsson", "pinnacle"];

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
