import type { LeagueAverage, MatchProbabilityEstimate, TeamGoalSplits } from "./types";

/**
 * Independent-Poisson match outcome model: each team's expected goals (λ) is derived
 * from its attack/defense strength (goals-for/against rate relative to the league's
 * home/away average), then P(home win)/P(draw)/P(away win) is the sum of
 * Poisson(i, λ_home) x Poisson(j, λ_away) over every scoreline (i, j) up to maxGoals.
 *
 * Known v1 limitation: this treats home and away goals as statistically independent.
 * Real scorelines have a slight negative correlation at low scores (the reason more
 * sophisticated models add a Dixon-Coles correction term) — intentionally not modeled
 * here per the initial scope; don't silently "fix" this without discussing it first.
 */

function poissonPmf(k: number, lambda: number): number {
  return (Math.exp(-lambda) * lambda ** k) / factorial(k);
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

export function estimateMatchProbabilities(
  home: TeamGoalSplits,
  away: TeamGoalSplits,
  leagueAvg: LeagueAverage,
  maxGoals = 10,
): MatchProbabilityEstimate {
  const homeAttack = (home.goalsFor / Math.max(home.matchesPlayed, 1)) / leagueAvg.avgHomeGoalsFor;
  const homeDefense = (home.goalsAgainst / Math.max(home.matchesPlayed, 1)) / leagueAvg.avgAwayGoalsFor;
  const awayAttack = (away.goalsFor / Math.max(away.matchesPlayed, 1)) / leagueAvg.avgAwayGoalsFor;
  const awayDefense = (away.goalsAgainst / Math.max(away.matchesPlayed, 1)) / leagueAvg.avgHomeGoalsFor;

  const expectedHomeGoals = homeAttack * awayDefense * leagueAvg.avgHomeGoalsFor;
  const expectedAwayGoals = awayAttack * homeDefense * leagueAvg.avgAwayGoalsFor;

  let homeWinProb = 0;
  let drawProb = 0;
  let awayWinProb = 0;
  let total = 0;

  for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals++) {
    for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals++) {
      const p = poissonPmf(homeGoals, expectedHomeGoals) * poissonPmf(awayGoals, expectedAwayGoals);
      total += p;
      if (homeGoals > awayGoals) homeWinProb += p;
      else if (homeGoals === awayGoals) drawProb += p;
      else awayWinProb += p;
    }
  }

  return {
    homeWinProb: homeWinProb / total,
    drawProb: drawProb / total,
    awayWinProb: awayWinProb / total,
    expectedHomeGoals,
    expectedAwayGoals,
  };
}
