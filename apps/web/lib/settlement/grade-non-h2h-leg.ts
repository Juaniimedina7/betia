import type {
  ApiFootballFixtureEvents,
  ApiFootballFixtureResult,
  ApiFootballFixtureStatistics,
} from "@bet/api-football-client";
import type { LegGrade } from "./grade-h2h-leg";

// Same status vocabulary as api-football-result.ts's toMatchResult (h2h path) — kept
// as its own copy here rather than shared, since these graders read different fields
// off ApiFootballFixtureResult and there's nothing else to couple them on.
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const UNPLAYED_STATUSES = new Set(["PST", "CANC", "ABD", "AWD", "WO"]);

/** "finished" = has a real result to grade against; "unplayed" = grade every leg on
 * this fixture void, don't guess; "pending" = not finished yet, try again later. */
function classifyStatus(statusShort: string): "finished" | "unplayed" | "pending" {
  if (UNPLAYED_STATUSES.has(statusShort)) return "unplayed";
  if (FINISHED_STATUSES.has(statusShort)) return "finished";
  return "pending";
}

export const GRADABLE_NON_H2H_MARKETS = [
  "odd_even",
  "to_score_in_both_halves_by_teams",
  "to_win_from_behind",
  "to_miss_a_penalty",
  "shots_1x2",
] as const;

interface GradableNonH2hLeg {
  /** Raw API-Football outcome value for this leg — "Odd"/"Even" for odd_even,
   * "Home"/"Away" for the two team-referenced markets below. */
  outcomeId: string;
}

function wonFromBehind(teamFT: number, oppFT: number, teamHT: number, oppHT: number): LegGrade {
  if (teamFT <= oppFT) return "lost"; // didn't even win the match
  if (teamHT < oppHT) return "won"; // confirmed behind at halftime, ahead by fulltime
  // A scoreless first half means neither side could have been behind before halftime
  // (no goals yet), and this team led or tied there — not "from behind".
  if (teamHT === 0 && oppHT === 0) return "lost";
  // Led or tied (non-zero) at halftime and won — can't rule out a within-half deficit
  // from just the halftime/fulltime snapshots (e.g. conceded then equalized inside the
  // same half). Void rather than guess, same rule grade-h2h-leg.ts follows.
  return "void";
}

function scoredBothHalves(fullTimeGoals: number, halftimeGoals: number): boolean {
  return halftimeGoals > 0 && fullTimeGoals - halftimeGoals > 0;
}

/**
 * Grades the small set of API-Football-only, soccer-only markets this codebase can
 * derive from a fixture's halftime + fulltime score alone — no separate stats/events
 * endpoint needed (see packages/api-football-client's ApiFootballFixtureResult). Any
 * market not in GRADABLE_NON_H2H_MARKETS, or an outcome value this function doesn't
 * recognize, returns null — the caller leaves the leg pending/void rather than
 * guessing, same "don't guess" rule gradeH2hLeg follows.
 */
export function gradeNonH2hLeg(
  leg: GradableNonH2hLeg,
  marketId: string,
  result: ApiFootballFixtureResult,
): LegGrade | null {
  const status = classifyStatus(result.statusShort);
  if (status === "unplayed") return "void";
  if (status === "pending") return null;

  const { homeGoals, awayGoals, homeGoalsHalftime, awayGoalsHalftime } = result;
  if (homeGoals === null || awayGoals === null) return null;

  switch (marketId) {
    case "odd_even": {
      const isOdd = (homeGoals + awayGoals) % 2 === 1;
      if (leg.outcomeId === "Odd") return isOdd ? "won" : "lost";
      if (leg.outcomeId === "Even") return isOdd ? "lost" : "won";
      return null;
    }
    case "to_score_in_both_halves_by_teams": {
      if (homeGoalsHalftime === null || awayGoalsHalftime === null) return null;
      if (leg.outcomeId === "Home") return scoredBothHalves(homeGoals, homeGoalsHalftime) ? "won" : "lost";
      if (leg.outcomeId === "Away") return scoredBothHalves(awayGoals, awayGoalsHalftime) ? "won" : "lost";
      return null;
    }
    case "to_win_from_behind": {
      if (homeGoalsHalftime === null || awayGoalsHalftime === null) return null;
      if (leg.outcomeId === "Home") return wonFromBehind(homeGoals, awayGoals, homeGoalsHalftime, awayGoalsHalftime);
      if (leg.outcomeId === "Away") return wonFromBehind(awayGoals, homeGoals, awayGoalsHalftime, homeGoalsHalftime);
      return null;
    }
    default:
      return null;
  }
}

/**
 * Grades a "to_miss_a_penalty" leg (API-Football bet id 100, confirmed live outcomes
 * "Home"/"Away") — that side wins iff it has at least one "Missed Penalty" event;
 * otherwise it loses. This isn't a complementary pair (both sides lose when neither
 * misses a penalty, the common case), so there's no tie/void case to handle here.
 *
 * `result` supplies fixture status (this endpoint doesn't report one of its own — see
 * ApiFootballFixtureEvents); `events` is null when the events endpoint returned nothing
 * for this fixture id (unresolvable id, or a genuinely eventless finished match — see
 * getFixtureEvents), which only matters if `result` says the match is actually finished.
 */
export function gradeToMissAPenaltyLeg(
  leg: GradableNonH2hLeg,
  result: ApiFootballFixtureResult,
  events: ApiFootballFixtureEvents | null,
): LegGrade | null {
  const status = classifyStatus(result.statusShort);
  if (status === "unplayed") return "void";
  if (status === "pending") return null;
  if (!events) return null; // finished, but the events endpoint had nothing for this id

  if (leg.outcomeId === "Home") return events.missedPenaltyByTeam.home ? "won" : "lost";
  if (leg.outcomeId === "Away") return events.missedPenaltyByTeam.away ? "won" : "lost";
  return null;
}

/**
 * Grades a "shots_1x2" leg (API-Football bet id 340 "Shots.1x2", confirmed live
 * outcomes "Home"/"Draw"/"Away") — compares each side's total shots for the match.
 *
 * `result` supplies fixture status (this endpoint doesn't report one of its own — see
 * ApiFootballFixtureStatistics); `stats` is null when the statistics endpoint had
 * nothing for this fixture id, or either total is null when API-Football just doesn't
 * report statistics for this competition — either way, leave the leg pending rather
 * than guess.
 */
export function gradeShots1x2Leg(
  leg: GradableNonH2hLeg,
  result: ApiFootballFixtureResult,
  stats: ApiFootballFixtureStatistics | null,
): LegGrade | null {
  const status = classifyStatus(result.statusShort);
  if (status === "unplayed") return "void";
  if (status === "pending") return null;
  if (!stats || stats.homeTotalShots === null || stats.awayTotalShots === null) return null;

  const { homeTotalShots, awayTotalShots } = stats;
  if (leg.outcomeId === "Home") return homeTotalShots > awayTotalShots ? "won" : "lost";
  if (leg.outcomeId === "Away") return awayTotalShots > homeTotalShots ? "won" : "lost";
  if (leg.outcomeId === "Draw") return homeTotalShots === awayTotalShots ? "won" : "lost";
  return null;
}
