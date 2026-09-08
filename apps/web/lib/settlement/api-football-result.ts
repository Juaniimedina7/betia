import type { ApiFootballFixtureResult } from "@bet/api-football-client";
import type { MatchResult } from "./grade-h2h-leg";

// "FT"/"AET"/"PEN" = the match played out and goals is a real, final score.
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
// Completed in the sense that nothing further will happen, but with no valid score to
// grade against — same "void, don't guess" treatment grade-h2h-leg.ts already gives a
// postponed/cancelled Odds-API event with no scores.
const UNPLAYED_STATUSES = new Set(["PST", "CANC", "ABD", "AWD", "WO"]);

/**
 * Maps one API-Football fixture result onto the same provider-agnostic MatchResult
 * shape The Odds API's Score already conforms to, so gradeH2hLeg can grade either
 * provider's fixtures without knowing which one it's looking at.
 */
export function toMatchResult(result: ApiFootballFixtureResult): MatchResult {
  if (FINISHED_STATUSES.has(result.statusShort)) {
    if (result.homeGoals === null || result.awayGoals === null) return { completed: false, scores: null };
    return {
      completed: true,
      scores: [
        { name: result.homeTeam, score: String(result.homeGoals) },
        { name: result.awayTeam, score: String(result.awayGoals) },
      ],
    };
  }
  if (UNPLAYED_STATUSES.has(result.statusShort)) {
    return { completed: true, scores: null };
  }
  return { completed: false, scores: null };
}
