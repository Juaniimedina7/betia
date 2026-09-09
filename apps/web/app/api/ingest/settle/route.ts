import { getApiFootballClient, type ApiFootballFixtureResult } from "@bet/api-football-client";
import { betSlipLegs, betSlips, getDb } from "@bet/db";
import { getOddsApiClient, type Score } from "@bet/odds-api-client";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { toMatchResult } from "@/lib/settlement/api-football-result";
import { deriveSlipStatus } from "@/lib/settlement/derive-slip-status";
import { gradeH2hLeg, type LegGrade, type MatchResult } from "@/lib/settlement/grade-h2h-leg";

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
      participant1Id: betSlipLegs.participant1Id,
      participant2Id: betSlipLegs.participant2Id,
      outcomeId: betSlipLegs.outcomeId,
    })
    .from(betSlipLegs)
    .innerJoin(betSlips, eq(betSlipLegs.betSlipId, betSlips.id))
    .where(
      and(
        eq(betSlipLegs.status, "pending"),
        eq(betSlipLegs.marketId, "h2h"),
        lte(betSlipLegs.startTime, new Date(now - SETTLE_DELAY_MS)),
        gte(betSlipLegs.startTime, new Date(now - MAX_AGE_MS)),
        inArray(betSlips.status, ["saved", "placed_by_user"]),
      ),
    );

  const oddsApiLegs = pendingLegs.filter((leg) => !leg.fixtureId.startsWith(API_FOOTBALL_PREFIX));
  const apiFootballLegs = pendingLegs.filter((leg) => leg.fixtureId.startsWith(API_FOOTBALL_PREFIX));

  const resultsByFixtureId = new Map<string, MatchResult>();
  const errors: Record<string, string> = {};

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

  let apiFootballQuota: unknown;
  if (apiFootballFixtureIds.length > 0) {
    try {
      const client = getApiFootballClient();
      const results: ApiFootballFixtureResult[] = await client.getFixtureResults(apiFootballFixtureIds);
      for (const result of results) {
        resultsByFixtureId.set(`${API_FOOTBALL_PREFIX}${result.fixtureId}`, toMatchResult(result));
      }
      apiFootballQuota = client.getLastQuotaSnapshot();
    } catch (err) {
      errors.apiFootball = String(err);
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
    const result = resultsByFixtureId.get(leg.fixtureId);
    if (!result) continue; // provider didn't return this fixture (too old, wrong id, etc.)

    const grade = gradeH2hLeg(leg, result);
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
