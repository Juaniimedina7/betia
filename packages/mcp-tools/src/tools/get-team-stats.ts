import { getDb, teamSeasonStats } from "@bet/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resolveLeagueRef } from "../league-map";
import { getResolvedTeamId } from "../team-resolution";

export const getTeamStatsInput = z.object({
  teamName: z.string(),
  sportKey: z.string(),
});

export type GetTeamStatsInput = z.infer<typeof getTeamStatsInput>;

/**
 * DB-only read (no live Highlightly call — the ingestion cron owns that budget, see
 * CLAUDE.md's "Highlightly quota" section). Statistical (Poisson-derived) data, never
 * to be confused with market-implied numbers from build_combo/get_best_price.
 */
export async function getTeamStats(input: GetTeamStatsInput) {
  const league = resolveLeagueRef(input.sportKey);
  if (!league) {
    return { resolved: false as const, reason: "tournament_not_mapped" as const };
  }

  const externalTeamId = await getResolvedTeamId(input.sportKey, input.teamName);
  if (!externalTeamId) {
    return { resolved: false as const, reason: "team_not_resolved" as const };
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(teamSeasonStats)
    .where(
      and(
        eq(teamSeasonStats.externalTeamId, externalTeamId),
        eq(teamSeasonStats.leagueId, league.leagueId),
        eq(teamSeasonStats.season, league.season),
      ),
    )
    .limit(1);

  if (!row) {
    return { resolved: true as const, source: "no-data" as const };
  }

  return {
    resolved: true as const,
    source: "db" as const,
    teamName: row.teamName,
    staleAsOf: row.updatedAt,
    home: {
      matchesPlayed: row.matchesPlayedHome,
      wins: row.winsHome,
      draws: row.drawsHome,
      losses: row.lossesHome,
      goalsFor: row.goalsForHome,
      goalsAgainst: row.goalsAgainstHome,
    },
    away: {
      matchesPlayed: row.matchesPlayedAway,
      wins: row.winsAway,
      draws: row.drawsAway,
      losses: row.lossesAway,
      goalsFor: row.goalsForAway,
      goalsAgainst: row.goalsAgainstAway,
    },
  };
}
