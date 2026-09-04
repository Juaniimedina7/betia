import type { Score } from "@bet/odds-api-client";

export type LegGrade = "won" | "lost" | "void";

interface GradableLeg {
  /** bet_slip_legs.participant1Id — the home team name at save time. */
  participant1Id: string;
  /** bet_slip_legs.participant2Id — the away team name at save time. */
  participant2Id: string;
  /** bet_slip_legs.outcomeId — the team name (or "Draw") the leg bet on. */
  outcomeId: string;
}

/**
 * Grades a single h2h (moneyline) leg against a fetched Score. Returns null when the
 * match hasn't finished yet (or its result can't be determined with confidence) — the
 * caller should leave the leg "pending" rather than guess.
 */
export function gradeH2hLeg(leg: GradableLeg, score: Score): LegGrade | null {
  if (!score.completed) return null;

  // Postponed/cancelled events come back completed with no scores — nothing to grade.
  if (!score.scores || score.scores.length === 0) return "void";

  const homeEntry = score.scores.find((s) => s.name === leg.participant1Id);
  const awayEntry = score.scores.find((s) => s.name === leg.participant2Id);
  if (!homeEntry || !awayEntry) return null; // name mismatch — don't guess, leave pending

  const homeScore = Number(homeEntry.score);
  const awayScore = Number(awayEntry.score);
  if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) return null;

  let winningSide: string | "Draw" | null;
  if (homeScore > awayScore) winningSide = leg.participant1Id;
  else if (awayScore > homeScore) winningSide = leg.participant2Id;
  else winningSide = "Draw";

  // A tie with no "Draw" outcome on this leg's market (e.g. an NFL h2h, which only
  // ever has two outcomes) isn't gradable against what was actually offered — void it
  // instead of guessing.
  if (winningSide === "Draw" && leg.outcomeId !== "Draw") return "void";

  return leg.outcomeId === winningSide ? "won" : "lost";
}
