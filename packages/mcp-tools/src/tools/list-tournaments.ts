import { getDb, tournamentsCache } from "@bet/db";
import { getOddsPapiClient, type Tournament } from "@bet/oddspapi-client";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { toUserFacingError } from "../user-facing-error";

export const listTournamentsInput = z.object({
  sportId: z.string(),
});

export type ListTournamentsInput = z.infer<typeof listTournamentsInput>;

export async function listTournaments(input: ListTournamentsInput) {
  try {
    const tournaments = await getOddsPapiClient().listTournaments(input.sportId);
    await cacheTournaments(tournaments);
    return { tournaments, source: "live" as const, cachedAt: undefined as string | undefined };
  } catch (liveError) {
    const cached = await readCachedTournaments(input.sportId);
    if (cached.tournaments.length > 0) {
      return { ...cached, source: "cache" as const };
    }
    throw toUserFacingError(liveError);
  }
}

async function cacheTournaments(tournaments: Tournament[]): Promise<void> {
  if (tournaments.length === 0) return;
  try {
    await getDb()
      .insert(tournamentsCache)
      .values(
        tournaments.map((t) => ({ tournamentId: t.tournamentId, sportId: t.sportId, name: t.name })),
      )
      .onConflictDoUpdate({
        target: tournamentsCache.tournamentId,
        set: { sportId: sql`excluded.sport_id`, name: sql`excluded.name`, updatedAt: sql`now()` },
      });
  } catch {
    // Best-effort backup — a DB hiccup shouldn't break the live response.
  }
}

async function readCachedTournaments(
  sportId: string,
): Promise<{ tournaments: Tournament[]; cachedAt: string | undefined }> {
  try {
    const rows = await getDb()
      .select()
      .from(tournamentsCache)
      .where(eq(tournamentsCache.sportId, sportId));
    const cachedAt = rows.reduce<Date | undefined>(
      (latest, r) => (!latest || r.updatedAt > latest ? r.updatedAt : latest),
      undefined,
    );
    return {
      tournaments: rows.map((r) => ({ tournamentId: r.tournamentId, sportId: r.sportId, name: r.name })),
      cachedAt: cachedAt?.toISOString(),
    };
  } catch {
    return { tournaments: [], cachedAt: undefined };
  }
}
