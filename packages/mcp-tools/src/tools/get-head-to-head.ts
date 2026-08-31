import { getDb, teamHeadToHead } from "@bet/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getResolvedTeamId, orderTeamPair } from "../team-resolution";

export const getHeadToHeadInput = z.object({
  participant1Id: z.string(),
  participant2Id: z.string(),
});

export type GetHeadToHeadInput = z.infer<typeof getHeadToHeadInput>;

/** DB-only read, same rationale as get-team-stats.ts (never a live Highlightly call). */
export async function getHeadToHead(input: GetHeadToHeadInput) {
  const [team1Id, team2Id] = await Promise.all([
    getResolvedTeamId(input.participant1Id),
    getResolvedTeamId(input.participant2Id),
  ]);

  if (!team1Id || !team2Id) {
    return { resolved: false as const, reason: "team_not_resolved" as const };
  }

  const [teamAId, teamBId] = orderTeamPair(team1Id, team2Id);
  const db = getDb();
  const [row] = await db
    .select()
    .from(teamHeadToHead)
    .where(and(eq(teamHeadToHead.teamAId, teamAId), eq(teamHeadToHead.teamBId, teamBId)))
    .limit(1);

  if (!row) {
    return { resolved: true as const, source: "no-data" as const };
  }

  return {
    resolved: true as const,
    source: "db" as const,
    matchesPlayed: row.matchesPlayed,
    // Reported relative to participant1/participant2 as given, not teamA/teamB storage order.
    participant1Wins: teamAId === team1Id ? row.teamAWins : row.teamBWins,
    participant2Wins: teamAId === team1Id ? row.teamBWins : row.teamAWins,
    draws: row.draws,
    lastMeetingAt: row.lastMeetingAt,
  };
}
