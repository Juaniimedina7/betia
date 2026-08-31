import type { LeagueAverage, TeamGoalSplits } from "./types";

// Rough global soccer averages (goals per team per match), home advantage included.
// Used until enough teams have been ingested for a given league/season to compute a
// real average — see MIN_TEAMS_FOR_COMPUTED_AVERAGE below.
const FALLBACK_LEAGUE_AVERAGE: LeagueAverage = {
  avgHomeGoalsFor: 1.45,
  avgAwayGoalsFor: 1.2,
  source: "fallback",
  sampleTeamCount: 0,
};

const MIN_TEAMS_FOR_COMPUTED_AVERAGE = 6;

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * League-average goals-for rate, derived from whichever teams' season stats are
 * already ingested for a (leagueId, season) — no dedicated league-stats API call.
 * Falls back to a fixed global average until there's a large-enough sample.
 */
export function deriveLeagueAverage(
  teams: { home: TeamGoalSplits; away: TeamGoalSplits }[],
): LeagueAverage {
  if (teams.length < MIN_TEAMS_FOR_COMPUTED_AVERAGE) return FALLBACK_LEAGUE_AVERAGE;

  const avgHomeGoalsFor = mean(teams.map((t) => t.home.goalsFor / Math.max(t.home.matchesPlayed, 1)));
  const avgAwayGoalsFor = mean(teams.map((t) => t.away.goalsFor / Math.max(t.away.matchesPlayed, 1)));

  return { avgHomeGoalsFor, avgAwayGoalsFor, source: "computed", sampleTeamCount: teams.length };
}
