/**
 * Groups market keys that describe essentially the same underlying question — picking
 * two legs from the same family in one combo is at minimum heavily correlated, and
 * often a flat logical contradiction (e.g. h2h "Home" + asian_handicap "Away -1.5":
 * if Home wins at all, Away can't have covered a negative handicap). Used by
 * `buildSameMatchCombo` (search.ts) as the conflict key instead of `fixtureId`, so a
 * same-match combo never picks two legs from one family.
 *
 * Deliberately NOT exhaustive over API-Football's 150+ market keys — a market key with
 * no entry here just falls back to using its own key as the conflict key (see
 * `marketFamilyOf` below), which is already the safe minimum: it guarantees two
 * outcomes of the exact same market (e.g. "Over 2.5" and "Under 2.5" both from
 * `goals_over_under`) can never both be picked, since a market's own outcomes are
 * mutually exclusive by construction. Cross-market correlation for anything outside
 * this table (most player-prop markets, corners, cards, ...) isn't modeled — that
 * residual risk is why `buildSameMatchCombo`'s result always carries a `disclaimer`
 * about correlation not being priced in, rather than a false promise of completeness.
 *
 * Half-scoped variants (first_half/second_half) get their own family, not merged into
 * the full-match one — "who wins the first half" and "who wins the match" aren't
 * mutually exclusive (a team can win the first half and still lose the match), so
 * lumping them together would over-restrict combos for no real correctness gain.
 */
export const MARKET_FAMILY: Record<string, string> = {
  // Full-match result (who wins, with or without a margin) — includes every market
  // whose "Yes"/team outcome, if true, necessarily means that team won the match:
  // winning both halves implies winning at least one (to_win_either_half) and the
  // match itself; winning to nil or coming from behind to win both imply the match
  // winner too. Confirmed live 2026-09-09: to_win_either_half ("Home" 1.57) and
  // win_both_halves ("Home" 6.5) were NOT grouped together before this and got
  // combined into one same-match combo despite win_both_halves⟹to_win_either_half —
  // the "10x" shown was really just win_both_halves' own 6.5x, double-counted.
  h2h: "result",
  home_away: "result",
  double_chance: "result",
  asian_handicap: "result",
  handicap_result: "result",
  ht_ft_double: "result",
  win_both_halves: "result",
  home_win_both_halves: "result",
  away_win_both_halves: "result",
  to_win_either_half: "result",
  win_to_nil: "result",
  win_to_nil_home: "result",
  win_to_nil_away: "result",
  to_win_from_behind: "result",
  home_come_from_behind_and_win: "result",
  away_come_from_behind_and_win: "result",

  // First-half-scoped result
  first_half_winner: "result_1h",
  double_chance_first_half: "result_1h",
  asian_handicap_first_half: "result_1h",
  handicap_result_first_half: "result_1h",

  // Second-half-scoped result
  second_half_winner: "result_2h",
  double_chance_second_half: "result_2h",
  asian_handicap_2nd_half: "result_2h",

  // Full-match total goals
  goals_over_under: "goals_total",
  total_home: "goals_total",
  total_away: "goals_total",
  goal_line: "goals_total",
  result_total_goals: "goals_total",

  // Half-scoped total goals
  goals_over_under_first_half: "goals_total_1h",
  goal_line_1st_half: "goals_total_1h",
  goals_over_under_second_half: "goals_total_2h",

  // Both teams to score
  both_teams_score: "btts",
  results_both_teams_score: "btts",
  to_score_in_both_halves: "btts",
  both_teams_to_score_in_both_halves: "btts",
  both_teams_score_first_half: "btts_1h",
  both_teams_to_score_second_half: "btts_2h",

  // Odd/even total goals
  odd_even: "odd_even",
  odd_even_first_half: "odd_even_1h",
  odd_even_second_half: "odd_even_2h",
  home_odd_even: "odd_even_home",
  away_odd_even: "odd_even_away",
};

/** A market outside MARKET_FAMILY uses its own key as the family — see the module doc. */
export function marketFamilyOf(marketId: string): string {
  return MARKET_FAMILY[marketId] ?? marketId;
}
