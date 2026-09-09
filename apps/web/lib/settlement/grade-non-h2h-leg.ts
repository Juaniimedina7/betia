import type { ApiFootballFixtureResult } from "@bet/api-football-client";
import type { LegGrade } from "./grade-h2h-leg";

// Same status vocabulary as api-football-result.ts's toMatchResult (h2h path) — kept
// as its own copy here rather than shared, since the two graders read different
// fields off ApiFootballFixtureResult and there's nothing else to couple them on.
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const UNPLAYED_STATUSES = new Set(["PST", "CANC", "ABD", "AWD", "WO"]);

export const GRADABLE_NON_H2H_MARKETS = [
  "odd_even",
  "to_score_in_both_halves_by_teams",
  "to_win_from_behind",
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
  if (UNPLAYED_STATUSES.has(result.statusShort)) return "void";
  if (!FINISHED_STATUSES.has(result.statusShort)) return null; // not finished yet

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
