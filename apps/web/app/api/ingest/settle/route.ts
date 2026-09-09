import {
  getApiFootballClient,
  type ApiFootballFixtureEvents,
  type ApiFootballFixtureResult,
  type ApiFootballFixtureStatistics,
} from "@bet/api-football-client";
import { betSlipLegs, betSlips, getDb } from "@bet/db";
import { getOddsApiClient, type Score } from "@bet/odds-api-client";
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { matchFixture, type OddsCacheFixtureCandidate } from "@/lib/ingest/fixture-matching";
import { WATCHED_SOCCER_SPORT_KEYS } from "@/lib/ingest/watched-sport-keys";
import { toMatchResult } from "@/lib/settlement/api-football-result";
import { deriveSlipStatus } from "@/lib/settlement/derive-slip-status";
import { gradeH2hLeg, type LegGrade, type MatchResult } from "@/lib/settlement/grade-h2h-leg";
import {
  GRADABLE_NON_H2H_MARKETS,
  gradeNonH2hLeg,
  gradeShots1x2Leg,
  gradeToMissAPenaltyLeg,
} from "@/lib/settlement/grade-non-h2h-leg";

// Give a match time to actually finish before asking for its result.
const SETTLE_DELAY_MS = 3 * 60 * 60 * 1000;
// The Odds API's scores endpoint only covers the last 3 days (daysFrom's own cap) —
// a leg older than this is left "pending" indefinitely rather than retried forever.
// Known gap, no alerting built for it yet (see CLAUDE.md). API-Football's /fixtures
// lookup has no such window (it's id-based, not date-scoped), but the same cutoff is
// applied to both providers for one consistent, predictable abandonment rule.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const DAYS_FROM = 3;
// Defensive bound on distinct sport_keys queried per run against The Odds API —
// mirrors MAX_H2H_FETCHES_PER_RUN in poll-stats/route.ts. In practice this should
// almost never bind: most runs have zero pending sport_keys at all, since this route
// only calls the odds API for sports that actually have an unsettled bet past kickoff.
const MAX_SPORTS_PER_RUN = 10;
// Defensive bound on distinct API-Football fixture ids queried per run — mirrors
// MAX_FIXTURES_PER_DAY in poll-api-football-odds/route.ts, against the same 100/day
// Free-plan budget that route already spends most of. Batches of up to 20 ids/call
// (see getFixtureResults), so this caps at 2 calls' worth in the pathological case.
const MAX_API_FOOTBALL_FIXTURES_PER_RUN = 40;
// /fixtures/events and /fixtures/statistics take one fixture id per call each (no
// ids= batching like getFixtureResults) — a much smaller defensive cap than the one
// above since real to_miss_a_penalty/shots_1x2 volume is tiny (a handful of legs
// total as of 2026-09-09, see CLAUDE.md).
const MAX_EVENTS_OR_STATS_FIXTURES_PER_RUN = 20;

const API_FOOTBALL_PREFIX = "apifootball:";

/**
 * Grades pending bet_slip_legs against real match results and settles their bet_slips
 * once every leg is resolved. Costs nothing on a run with no unsettled bets — it only
 * calls out to a provider for fixtures that actually have a pending, past-kickoff h2h
 * leg. Routes each leg to whichever provider actually sourced its fixture:
 * `apifootball:<id>` fixtureIds (soccer, since 2026-09-08 — see CLAUDE.md's
 * "eliminar The Odds API de futbol" section) go through API-Football's
 * getFixtureResults; every other fixtureId (NBA/NFL/tennis, still sourced from The
 * Odds API) goes through the pre-existing getScores path. A soccer leg whose
 * fixtureId predates this migration (a raw The Odds API event id, not
 * `apifootball:`-prefixed) matches neither path and is left pending until MAX_AGE_MS
 * abandons it — a one-time cutover gap for whatever was still in flight, not an
 * ongoing one.
 *
 * Also grades GRADABLE_NON_H2H_MARKETS (odd_even, to_score_in_both_halves_by_teams,
 * to_win_from_behind, to_miss_a_penalty, shots_1x2 — see grade-non-h2h-leg.ts) for
 * soccer legs. A pending non-h2h leg whose fixtureId still lacks the `apifootball:`
 * prefix (a pre-2026-09-08-migration id, merged with API-Football odds without ever
 * recording that fixture's own numeric id) gets a live resolution pass first: grouped
 * by kickoff date, matched against that date's API-Football fixtures by team name
 * (matchFixture — the same logic poll-api-football-odds/route.ts already uses to
 * merge odds) — once resolved it's treated as a normal `apifootball:`-prefixed leg
 * for the rest of this run. h2h legs don't need this (they already grade fine via The
 * Odds API's getScores using their original id), so only non-h2h legs go through it.
 * Every other non-h2h market (spreads/totals/player props/etc.) still has no grading
 * at all — that's the pre-existing, still-accepted gap this doesn't touch.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = getDb();
  const now = Date.now();

  const pendingLegs = await db
    .select({
      id: betSlipLegs.id,
      betSlipId: betSlipLegs.betSlipId,
      fixtureId: betSlipLegs.fixtureId,
      sportId: betSlipLegs.sportId,
      marketId: betSlipLegs.marketId,
      participant1Id: betSlipLegs.participant1Id,
      participant2Id: betSlipLegs.participant2Id,
      outcomeId: betSlipLegs.outcomeId,
      startTime: betSlipLegs.startTime,
    })
    .from(betSlipLegs)
    .innerJoin(betSlips, eq(betSlipLegs.betSlipId, betSlips.id))
    .where(
      and(
        eq(betSlipLegs.status, "pending"),
        or(
          eq(betSlipLegs.marketId, "h2h"),
          // Every GRADABLE_NON_H2H_MARKETS market only ever comes from API-Football
          // (soccer-only), so gating on sportId here (rather than requiring the
          // `apifootball:` fixtureId prefix) also picks up legacy-id legs — the live
          // resolution pass below is what makes those actually gradable.
          and(inArray(betSlipLegs.marketId, GRADABLE_NON_H2H_MARKETS), inArray(betSlipLegs.sportId, WATCHED_SOCCER_SPORT_KEYS)),
        ),
        lte(betSlipLegs.startTime, new Date(now - SETTLE_DELAY_MS)),
        gte(betSlipLegs.startTime, new Date(now - MAX_AGE_MS)),
        inArray(betSlips.status, ["saved", "placed_by_user"]),
      ),
    );

  const errors: Record<string, string> = {};

  // Legacy fixtureId resolution — a pending non-h2h soccer leg can have a fixtureId
  // that's a raw pre-migration The Odds API event id (not `apifootball:`-prefixed)
  // because its odds_cache row was merged into by API-Football's ingest without ever
  // recording that fixture's own numeric id (see this file's header comment and
  // CLAUDE.md's "eliminar The Odds API de futbol"). Resolve those live, once per
  // distinct kickoff date, and rewrite the leg's fixtureId in memory (not persisted —
  // cheap enough to redo next run if this leg is still pending then) so the rest of
  // this function treats it exactly like a normal `apifootball:`-sourced leg.
  const legacyLegs = pendingLegs.filter(
    (leg) => leg.marketId !== "h2h" && !leg.fixtureId.startsWith(API_FOOTBALL_PREFIX),
  );
  if (legacyLegs.length > 0) {
    const legsByDate = new Map<string, typeof legacyLegs>();
    for (const leg of legacyLegs) {
      const dateKey = leg.startTime.toISOString().slice(0, 10);
      if (!legsByDate.has(dateKey)) legsByDate.set(dateKey, []);
      legsByDate.get(dateKey)!.push(leg);
    }

    const legacyClient = getApiFootballClient();
    for (const [dateKey, legsOnDate] of legsByDate) {
      try {
        const discovered = await legacyClient.findFixturesByDate(dateKey);
        const candidates: OddsCacheFixtureCandidate[] = discovered.map((f) => ({
          eventId: f.fixtureId,
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          commenceTime: new Date(f.commenceTime),
        }));
        // Resolve once per distinct old fixtureId, not per leg — legs sharing the
        // same fixtureId share the same teams/kickoff time.
        const resolvedByOldFixtureId = new Map<string, string>();
        for (const leg of legsOnDate) {
          if (resolvedByOldFixtureId.has(leg.fixtureId)) continue;
          const matched = matchFixture(leg.participant1Id, leg.participant2Id, leg.startTime, candidates);
          if (matched) resolvedByOldFixtureId.set(leg.fixtureId, matched);
        }
        for (const leg of legsOnDate) {
          const realId = resolvedByOldFixtureId.get(leg.fixtureId);
          if (realId) leg.fixtureId = `${API_FOOTBALL_PREFIX}${realId}`;
        }
      } catch (err) {
        errors[`legacyResolve:${dateKey}`] = String(err);
      }
    }
  }

  const oddsApiLegs = pendingLegs.filter((leg) => !leg.fixtureId.startsWith(API_FOOTBALL_PREFIX));
  const apiFootballLegs = pendingLegs.filter((leg) => leg.fixtureId.startsWith(API_FOOTBALL_PREFIX));

  const resultsByFixtureId = new Map<string, MatchResult>();

  // The Odds API side — unchanged from before this migration, just scoped to
  // oddsApiLegs instead of every pending leg.
  const fixtureIdsBySport = new Map<string, Set<string>>();
  for (const leg of oddsApiLegs) {
    if (!fixtureIdsBySport.has(leg.sportId)) fixtureIdsBySport.set(leg.sportId, new Set());
    fixtureIdsBySport.get(leg.sportId)!.add(leg.fixtureId);
  }
  const sportKeys = [...fixtureIdsBySport.keys()].slice(0, MAX_SPORTS_PER_RUN);

  let oddsApiQuota: unknown;
  if (sportKeys.length > 0) {
    const client = getOddsApiClient();
    for (const sportKey of sportKeys) {
      try {
        const scores: Score[] = await client.getScores(sportKey, {
          eventIds: [...fixtureIdsBySport.get(sportKey)!],
          daysFrom: DAYS_FROM,
        });
        for (const score of scores) resultsByFixtureId.set(score.eventId, score);
      } catch (err) {
        errors[sportKey] = String(err);
      }
    }
    oddsApiQuota = client.getLastQuotaSnapshot();
  }

  // API-Football side — soccer, since 2026-09-08. Fixture-based, not sport_key-based,
  // so every pending soccer fixture id goes into one batched lookup regardless of
  // which league it's in.
  const apiFootballFixtureIds = [
    ...new Set(apiFootballLegs.map((leg) => leg.fixtureId.slice(API_FOOTBALL_PREFIX.length))),
  ].slice(0, MAX_API_FOOTBALL_FIXTURES_PER_RUN);

  // Raw API-Football results, keyed the same way as resultsByFixtureId — needed
  // alongside the provider-agnostic MatchResult above because gradeNonH2hLeg grades
  // off halftime score, which MatchResult (shared with The Odds API's Score shape)
  // has no room for.
  const apiFootballRawByFixtureId = new Map<string, ApiFootballFixtureResult>();

  let apiFootballQuota: unknown;
  if (apiFootballFixtureIds.length > 0) {
    try {
      const client = getApiFootballClient();
      const results: ApiFootballFixtureResult[] = await client.getFixtureResults(apiFootballFixtureIds);
      for (const result of results) {
        const key = `${API_FOOTBALL_PREFIX}${result.fixtureId}`;
        resultsByFixtureId.set(key, toMatchResult(result));
        apiFootballRawByFixtureId.set(key, result);
      }
      apiFootballQuota = client.getLastQuotaSnapshot();
    } catch (err) {
      errors.apiFootball = String(err);
    }
  }

  // to_miss_a_penalty and shots_1x2 need per-fixture endpoints that don't batch by
  // ids= the way getFixtureResults does — only requested for fixtures that actually
  // have a pending leg on that specific market, so a fixture with only an h2h or
  // halftime-based leg pending never triggers these calls.
  const fixturesNeedingEvents = [
    ...new Set(
      apiFootballLegs
        .filter((leg) => leg.marketId === "to_miss_a_penalty")
        .map((leg) => leg.fixtureId.slice(API_FOOTBALL_PREFIX.length)),
    ),
  ].slice(0, MAX_EVENTS_OR_STATS_FIXTURES_PER_RUN);

  const eventsByFixtureId = new Map<string, ApiFootballFixtureEvents>();
  if (fixturesNeedingEvents.length > 0) {
    try {
      const client = getApiFootballClient();
      const events = await client.getFixtureEvents(fixturesNeedingEvents);
      for (const e of events) eventsByFixtureId.set(`${API_FOOTBALL_PREFIX}${e.fixtureId}`, e);
    } catch (err) {
      errors.apiFootballEvents = String(err);
    }
  }

  const fixturesNeedingStats = [
    ...new Set(
      apiFootballLegs
        .filter((leg) => leg.marketId === "shots_1x2")
        .map((leg) => leg.fixtureId.slice(API_FOOTBALL_PREFIX.length)),
    ),
  ].slice(0, MAX_EVENTS_OR_STATS_FIXTURES_PER_RUN);

  const statsByFixtureId = new Map<string, ApiFootballFixtureStatistics>();
  if (fixturesNeedingStats.length > 0) {
    try {
      const client = getApiFootballClient();
      const stats = await client.getFixtureStatistics(fixturesNeedingStats);
      for (const s of stats) statsByFixtureId.set(`${API_FOOTBALL_PREFIX}${s.fixtureId}`, s);
    } catch (err) {
      errors.apiFootballStats = String(err);
    }
  }

  const queriedFixtureIds = new Set([
    ...oddsApiLegs.filter((leg) => sportKeys.includes(leg.sportId)).map((leg) => leg.fixtureId),
    ...apiFootballLegs
      .filter((leg) => apiFootballFixtureIds.includes(leg.fixtureId.slice(API_FOOTBALL_PREFIX.length)))
      .map((leg) => leg.fixtureId),
  ]);

  let legsGraded = 0;
  const touchedBetSlipIds = new Set<string>();

  for (const leg of pendingLegs) {
    if (!queriedFixtureIds.has(leg.fixtureId)) continue; // skipped this run (a per-run cap, or a pre-migration id neither provider can resolve)

    let grade: LegGrade | null;
    if (leg.marketId === "h2h") {
      const result = resultsByFixtureId.get(leg.fixtureId);
      if (!result) continue; // provider didn't return this fixture (too old, wrong id, etc.)
      grade = gradeH2hLeg(leg, result);
    } else if (leg.marketId === "to_miss_a_penalty") {
      const result = apiFootballRawByFixtureId.get(leg.fixtureId);
      if (!result) continue; // provider didn't return this fixture
      grade = gradeToMissAPenaltyLeg(leg, result, eventsByFixtureId.get(leg.fixtureId) ?? null);
    } else if (leg.marketId === "shots_1x2") {
      const result = apiFootballRawByFixtureId.get(leg.fixtureId);
      if (!result) continue; // provider didn't return this fixture
      grade = gradeShots1x2Leg(leg, result, statsByFixtureId.get(leg.fixtureId) ?? null);
    } else {
      const rawResult = apiFootballRawByFixtureId.get(leg.fixtureId);
      if (!rawResult) continue; // provider didn't return this fixture
      grade = gradeNonH2hLeg(leg, leg.marketId, rawResult);
    }
    if (grade === null) continue; // not finished yet, or can't be graded confidently

    await db.update(betSlipLegs).set({ status: grade }).where(eq(betSlipLegs.id, leg.id));
    legsGraded++;
    touchedBetSlipIds.add(leg.betSlipId);
  }

  // Also pick up any already-unsettled slip that already has a "lost" leg from a
  // previous run — before the early-lost check below existed, a slip with a lost h2h
  // leg alongside a never-gradable non-h2h leg (see above) could get stuck "saved"
  // forever even though its outcome was already certain. This sweeps those clean too,
  // not just ones graded in this exact run.
  const alreadyLostSlips = await db
    .selectDistinct({ betSlipId: betSlipLegs.betSlipId })
    .from(betSlipLegs)
    .innerJoin(betSlips, eq(betSlipLegs.betSlipId, betSlips.id))
    .where(and(eq(betSlipLegs.status, "lost"), inArray(betSlips.status, ["saved", "placed_by_user"])));
  for (const { betSlipId } of alreadyLostSlips) touchedBetSlipIds.add(betSlipId);

  let slipsSettled = 0;
  for (const betSlipId of touchedBetSlipIds) {
    const legs = await db
      .select({ status: betSlipLegs.status })
      .from(betSlipLegs)
      .where(eq(betSlipLegs.betSlipId, betSlipId));

    // A single lost leg already dooms the whole parlay — settle it as "lost" right
    // away instead of waiting for every leg to resolve. This matters because some
    // legs (any non-h2h market) never get graded at all (see MatchResult/gradeH2hLeg
    // above), so waiting for "no pending left" could otherwise strand a slip forever
    // even once its outcome is already certain.
    const anyLost = legs.some((l) => l.status === "lost");
    if (!anyLost && legs.some((l) => l.status === "pending")) continue; // still waiting on another leg

    const status = anyLost ? "lost" : deriveSlipStatus(legs.map((l) => l.status as LegGrade));
    await db.update(betSlips).set({ status, settledAt: new Date() }).where(eq(betSlips.id, betSlipId));
    slipsSettled++;
  }

  return Response.json({
    legsGraded,
    slipsSettled,
    sportsQueried: sportKeys.length,
    apiFootballFixturesQueried: apiFootballFixtureIds.length,
    quota: { oddsApi: oddsApiQuota, apiFootball: apiFootballQuota },
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  });
}
