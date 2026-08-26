import type { CandidateLeg } from "./types";

/** Hard rule v1: never combine two legs from the same fixture. */
export function collidesWithSelection(candidate: CandidateLeg, selected: CandidateLeg[]): boolean {
  return selected.some((leg) => leg.fixtureId === candidate.fixtureId);
}

export function dedupeByFixture(legs: CandidateLeg[]): CandidateLeg[] {
  const seen = new Set<string>();
  const result: CandidateLeg[] = [];
  for (const leg of legs) {
    if (seen.has(leg.fixtureId)) continue;
    seen.add(leg.fixtureId);
    result.push(leg);
  }
  return result;
}
