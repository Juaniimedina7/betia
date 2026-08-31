import { getDb, teamIdMap } from "@bet/db";
import { eq } from "drizzle-orm";

/**
 * Reads the cached OddsPapi-participant -> external-team resolution written by
 * /api/ingest/poll-stats. Returns null if the participant was never seen, or if a
 * resolution was attempted and failed to find a confident name match.
 */
export async function getResolvedTeamId(participantId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ externalTeamId: teamIdMap.externalTeamId })
    .from(teamIdMap)
    .where(eq(teamIdMap.oddsPapiParticipantId, participantId))
    .limit(1);
  return row?.externalTeamId ?? null;
}

/** Sorts two external team ids into the canonical (teamAId < teamBId) pair order used by teamHeadToHead. */
export function orderTeamPair(teamId1: string, teamId2: string): [string, string] {
  return teamId1 < teamId2 ? [teamId1, teamId2] : [teamId2, teamId1];
}
