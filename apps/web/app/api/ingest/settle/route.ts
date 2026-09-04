import { betSlipLegs, betSlips, getDb } from "@bet/db";
import { getOddsApiClient, type Score } from "@bet/odds-api-client";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { deriveSlipStatus } from "@/lib/settlement/derive-slip-status";
import { gradeH2hLeg, type LegGrade } from "@/lib/settlement/grade-h2h-leg";

// Give a match time to actually finish before asking for its result.
const SETTLE_DELAY_MS = 3 * 60 * 60 * 1000;
// The Odds API's scores endpoint only covers the last 3 days (daysFrom's own cap) —
// a leg older than this is left "pending" indefinitely rather than retried forever.
// Known gap, no alerting built for it yet (see CLAUDE.md).
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const DAYS_FROM = 3;
// Defensive bound on distinct sport_keys queried per run — mirrors
// MAX_H2H_FETCHES_PER_RUN in poll-stats/route.ts. In practice this should almost
// never bind: most runs have zero pending sport_keys at all, since this route only
// calls the odds API for sports that actually have an unsettled bet past kickoff.
const MAX_SPORTS_PER_RUN = 10;

/**
 * Grades pending bet_slip_legs against real match results and settles their bet_slips
 * once every leg is resolved. Unlike the odds/stats crons, this one costs nothing on a
 * run with no unsettled bets — it only calls The Odds API for sport_keys that actually
 * have a pending, past-kickoff h2h leg. The scores endpoint costs a flat 2 credits per
 * call (confirmed live 2026-09-04, see CLAUDE.md) regardless of eventIds/daysFrom, so
 * keeping calls need-based (not "poll every watched sport every run" like poll/route.ts)
 * is what keeps this affordable against the already-tight monthly budget.
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

  if (pendingLegs.length === 0) {
    return Response.json({ legsGraded: 0, slipsSettled: 0, sportsQueried: 0 });
  }

  const fixtureIdsBySport = new Map<string, Set<string>>();
  for (const leg of pendingLegs) {
    if (!fixtureIdsBySport.has(leg.sportId)) fixtureIdsBySport.set(leg.sportId, new Set());
    fixtureIdsBySport.get(leg.sportId)!.add(leg.fixtureId);
  }
  const sportKeys = [...fixtureIdsBySport.keys()].slice(0, MAX_SPORTS_PER_RUN);

  const client = getOddsApiClient();
  const scoresByFixtureId = new Map<string, Score>();
  const sportErrors: Record<string, string> = {};

  for (const sportKey of sportKeys) {
    try {
      const scores = await client.getScores(sportKey, {
        eventIds: [...fixtureIdsBySport.get(sportKey)!],
        daysFrom: DAYS_FROM,
      });
      for (const score of scores) scoresByFixtureId.set(score.eventId, score);
    } catch (err) {
      sportErrors[sportKey] = String(err);
    }
  }

  let legsGraded = 0;
  const touchedBetSlipIds = new Set<string>();

  for (const leg of pendingLegs) {
    if (!sportKeys.includes(leg.sportId)) continue; // skipped this run (MAX_SPORTS_PER_RUN cap)
    const score = scoresByFixtureId.get(leg.fixtureId);
    if (!score) continue; // API didn't return this fixture (too old, wrong id, etc.)

    const grade = gradeH2hLeg(leg, score);
    if (grade === null) continue; // not finished yet, or can't be graded confidently

    await db.update(betSlipLegs).set({ status: grade }).where(eq(betSlipLegs.id, leg.id));
    legsGraded++;
    touchedBetSlipIds.add(leg.betSlipId);
  }

  let slipsSettled = 0;
  for (const betSlipId of touchedBetSlipIds) {
    const legs = await db
      .select({ status: betSlipLegs.status })
      .from(betSlipLegs)
      .where(eq(betSlipLegs.betSlipId, betSlipId));

    if (legs.some((l) => l.status === "pending")) continue; // still waiting on another leg

    const status = deriveSlipStatus(legs.map((l) => l.status as LegGrade));
    await db.update(betSlips).set({ status, settledAt: new Date() }).where(eq(betSlips.id, betSlipId));
    slipsSettled++;
  }

  return Response.json({
    legsGraded,
    slipsSettled,
    sportsQueried: sportKeys.length,
    quota: client.getLastQuotaSnapshot(),
    errors: Object.keys(sportErrors).length > 0 ? sportErrors : undefined,
  });
}
