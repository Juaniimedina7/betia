// Matches an API-Football fixture to an existing odds_cache row (populated by The Odds
// API) so a second provider's bookmakers can be merged into the same row instead of
// creating a duplicate-looking fixture for the same real-world match. Reuses the same
// pragmatic exact-then-fuzzy team-name matching as team-name-matching.ts (that one
// resolves a team name to a Highlightly id; this resolves a fixture to an odds_cache
// row), scoped per sport_key and a kickoff-time window rather than a global search —
// same rationale as that module: narrowing the candidate pool first makes exact-then-
// fuzzy matching safe without needing anything more sophisticated.

import { resolveTeamName, type NamedTeamCandidate } from "./team-name-matching";

export interface OddsCacheFixtureCandidate {
  eventId: string;
  homeTeam: string | null;
  awayTeam: string | null;
  commenceTime: Date | null;
}

/** Bookmakers post lines with slightly different kickoff timestamps rounding, and
 * fixtures occasionally get rescheduled by a few minutes between providers' last
 * refresh — 90 minutes comfortably separates two different real matches while
 * tolerating that kind of provider drift. */
const TIME_TOLERANCE_MS = 90 * 60 * 1000;

/**
 * Returns the eventId of the odds_cache row (already scoped by the caller to one
 * sport_key) that best matches this API-Football fixture's home/away teams and
 * kickoff time, or undefined if nothing qualifies — callers should insert a new,
 * synthetically-keyed row in that case rather than guess.
 */
export function matchFixture(
  homeTeam: string,
  awayTeam: string,
  commenceTime: Date,
  candidates: OddsCacheFixtureCandidate[],
): string | undefined {
  const withinWindow = candidates.filter(
    (c) => c.commenceTime && Math.abs(c.commenceTime.getTime() - commenceTime.getTime()) <= TIME_TOLERANCE_MS,
  );
  if (withinWindow.length === 0) return undefined;

  const homeCandidates: NamedTeamCandidate[] = withinWindow
    .filter((c): c is OddsCacheFixtureCandidate & { homeTeam: string } => c.homeTeam !== null)
    .map((c) => ({ teamId: c.eventId, name: c.homeTeam }));
  const homeMatch = resolveTeamName(homeTeam, homeCandidates);
  if (!homeMatch) return undefined;

  const matchedRow = withinWindow.find((c) => c.eventId === homeMatch.team.teamId);
  if (!matchedRow?.awayTeam) return undefined;

  const awayMatch = resolveTeamName(awayTeam, [{ teamId: matchedRow.eventId, name: matchedRow.awayTeam }]);
  if (!awayMatch) return undefined;

  return matchedRow.eventId;
}
