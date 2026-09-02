import type { LeagueAverage, MatchProbabilityEstimate, TeamGoalSplits } from "./types";

/**
 * Independent-Poisson match outcome model with a Dixon-Coles low-score correction:
 * each team's expected goals (λ) is derived from its attack/defense strength
 * (goals-for/against rate relative to the league's home/away average), then
 * P(home win)/P(draw)/P(away win) is the sum of a Dixon-Coles-adjusted joint pmf over
 * every scoreline (i, j) up to maxGoals.
 *
 * Dixon-Coles caveat: the correction's ρ parameter is normally fit per league/season
 * via maximum likelihood over actual match-by-match scorelines (Dixon & Coles, 1997).
 * We don't have that data — `team_season_stats` only stores cumulative goals-for/
 * against per home/away, not individual match results — so DEFAULT_RHO below is a
 * fixed constant taken from the original paper's typical range for English football
 * (-0.1 to -0.2), not fit against this project's own data. Treat it as "a reasonable
 * literature default," not a calibrated parameter — revisit if match-level results
 * ever get ingested.
 */

const DEFAULT_RHO = -0.1;

function poissonPmf(k: number, lambda: number): number {
  return (Math.exp(-lambda) * lambda ** k) / factorial(k);
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/**
 * Dixon-Coles τ (tau) adjustment factor — only scorelines with at most 1 goal per
 * side are corrected; everything else keeps the independent-Poisson joint pmf
 * unchanged (τ = 1). Captures the empirical tendency for low-scoring draws/near-draws
 * to occur slightly more/less often than independence alone predicts.
 */
function tau(homeGoals: number, awayGoals: number, lambda: number, mu: number, rho: number): number {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambda * mu * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambda * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + mu * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

export function estimateMatchProbabilities(
  home: TeamGoalSplits,
  away: TeamGoalSplits,
  leagueAvg: LeagueAverage,
  maxGoals = 10,
  rho = DEFAULT_RHO,
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
      const independent = poissonPmf(homeGoals, expectedHomeGoals) * poissonPmf(awayGoals, expectedAwayGoals);
      const p = independent * tau(homeGoals, awayGoals, expectedHomeGoals, expectedAwayGoals, rho);
      total += p;
      if (homeGoals > awayGoals) homeWinProb += p;
      else if (homeGoals === awayGoals) drawProb += p;
      else awayWinProb += p;
    }
  }

  return {
    // Re-normalize: the tau adjustment shifts probability mass among the low
    // scorelines it touches, so the joint pmf no longer sums to exactly 1 on its own.
    homeWinProb: homeWinProb / total,
    drawProb: drawProb / total,
    awayWinProb: awayWinProb / total,
    expectedHomeGoals,
    expectedAwayGoals,
  };
}
