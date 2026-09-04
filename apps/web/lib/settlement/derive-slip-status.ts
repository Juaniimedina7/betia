import type { LegGrade } from "./grade-h2h-leg";

/**
 * Standard parlay rule: any lost leg loses the whole slip; void legs are excluded
 * (a fully-void slip pushes); otherwise every leg won. Only call this once every leg
 * is resolved (no "pending" left) — a mid-resolution slip isn't gradable yet.
 */
export function deriveSlipStatus(legGrades: LegGrade[]): "won" | "lost" | "push" {
  if (legGrades.includes("lost")) return "lost";
  if (legGrades.every((g) => g === "void")) return "push";
  return "won";
}
