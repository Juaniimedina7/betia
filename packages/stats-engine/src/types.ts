export interface TeamGoalSplits {
  matchesPlayed: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface LeagueAverage {
  avgHomeGoalsFor: number;
  avgAwayGoalsFor: number;
  source: "computed" | "fallback";
  sampleTeamCount: number;
}

export interface MatchProbabilityEstimate {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
}
