import { getDb, teamHeadToHead } from "@bet/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getResolvedTeamId, orderTeamPair } from "../team-resolution";

export const getHeadToHeadInput = z.object({
  homeTeam: z.string(),
  awayTeam: z.string(),
  sportKey: z.string(),
});

export type GetHeadToHeadInput = z.infer<typeof getHeadToHeadInput>;

/** DB-only read, same rationale as get-team-stats.ts (never a live Highlightly call). */
export async function getHeadToHead(input: GetHeadToHeadInput) {
  const [homeTeamId, awayTeamId] = await Promise.all([
    getResolvedTeamId(input.sportKey, input.homeTeam),
    getResolvedTeamId(input.sportKey, input.awayTeam),
  ]);

  if (!homeTeamId || !awayTeamId) {
    return { resolved: false as const, reason: "team_not_resolved" as const };
  }

  const [teamAId, teamBId] = orderTeamPair(homeTeamId, awayTeamId);
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
    // Reported relative to homeTeam/awayTeam as given, not teamA/teamB storage order.
    homeTeamWins: teamAId === homeTeamId ? row.teamAWins : row.teamBWins,
    awayTeamWins: teamAId === homeTeamId ? row.teamBWins : row.teamAWins,
    draws: row.draws,
    lastMeetingAt: row.lastMeetingAt,
  };
}
