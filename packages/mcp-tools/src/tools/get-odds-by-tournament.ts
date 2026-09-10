import { getDb, oddsCache } from "@bet/db";
import { and, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { notStartedCondition } from "../fixture-time";
import type { BookmakerOdds } from "@bet/odds-api-client";

export const getOddsByTournamentInput = z.object({
  sportKeys: z.array(z.string()).min(1),
  // ISO 8601 kickoff-time window (UTC), same contract as build_combo's from/to —
  // without these, every cached UPCOMING fixture for the given sport_keys comes back.
  // Added 2026-09-08; this was the one "list"-style odds tool with no date filter at
  // all (list_fixtures and build_combo already had it). Independently of from/to, a
  // fixture whose kickoff already passed is always excluded (see notStartedCondition
  // in ../fixture-time).
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export type GetOddsByTournamentInput = z.infer<typeof getOddsByTournamentInput>;

/**
 * DB-only read of odds_cache scoped to a set of sport_keys — no live call, no
 * `bookmaker` param (cached rows already carry whichever bookmakers /api/ingest/poll
 * chose; there's nothing to filter to a single book here).
 */
export interface TournamentOddsSummary {
  fixtureId: string;
  sportKey: string;
  tournamentId: string;
  homeTeam?: string;
  awayTeam?: string;
  startTime: string;
  bookmakerOdds: BookmakerOdds;
}

export async function getOddsByTournament(input: GetOddsByTournamentInput) {
  const db = getDb();
  const conditions = [inArray(oddsCache.sportKey, input.sportKeys), isNotNull(oddsCache.bookmakerOdds), notStartedCondition()];
  if (input.from) conditions.push(gte(oddsCache.commenceTime, new Date(input.from)));
  if (input.to) conditions.push(lte(oddsCache.commenceTime, new Date(input.to)));
  const rows = await db
    .select()
    .from(oddsCache)
    .where(and(...conditions));

  const fixtures: TournamentOddsSummary[] = rows.map((r) => ({
    fixtureId: r.eventId,
    sportKey: r.sportKey,
    tournamentId: r.sportKey,
    homeTeam: r.homeTeam ?? undefined,
    awayTeam: r.awayTeam ?? undefined,
    startTime: (r.commenceTime ?? r.updatedAt).toISOString(),
    bookmakerOdds: r.bookmakerOdds as BookmakerOdds,
  }));

  return { fixtures };
}
