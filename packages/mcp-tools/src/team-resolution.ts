import { getDb, teamIdMap } from "@bet/db";
import { eq } from "drizzle-orm";

const DIACRITICS_REGEX = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * `${sportKey}:${slug(teamName)}` — the odds provider has no stable participant id,
 * only name strings, so this is the tightest collision boundary available. Scoping by
 * sport_key (not just the coarser sport) means the same real-world club playing in two
 * watched competitions gets two independent rows/resolutions — not a new problem,
 * `/api/ingest/poll-stats` already resolved teams per-tournament before this change.
 */
export function buildTeamKey(sportKey: string, teamName: string): string {
  const slug = teamName
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${sportKey}:${slug}`;
}

/**
 * Reads the cached team-name -> external-team resolution written by
 * /api/ingest/poll-stats. Returns null if the team was never seen, or if a resolution
 * was attempted and failed to find a confident name match.
 */
export async function getResolvedTeamId(sportKey: string, teamName: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ externalTeamId: teamIdMap.externalTeamId })
    .from(teamIdMap)
    .where(eq(teamIdMap.teamKey, buildTeamKey(sportKey, teamName)))
    .limit(1);
  return row?.externalTeamId ?? null;
}

/** Sorts two external team ids into the canonical (teamAId < teamBId) pair order used by teamHeadToHead. */
export function orderTeamPair(teamId1: string, teamId2: string): [string, string] {
  return teamId1 < teamId2 ? [teamId1, teamId2] : [teamId2, teamId1];
}
