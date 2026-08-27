import { getDb, oddsCache } from "@bet/db";
import { getOddsPapiClient, type Fixture } from "@bet/oddspapi-client";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

export const listFixturesInput = z.object({
  sportId: z.string().optional(),
  tournamentId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  statusId: z.string().optional(),
});

export type ListFixturesInput = z.infer<typeof listFixturesInput>;

export async function listFixtures(input: ListFixturesInput) {
  try {
    const fixtures = await getOddsPapiClient().listFixtures(input);
    await cacheFixtures(fixtures);
    return { fixtures, source: "live" as const, cachedAt: undefined as string | undefined };
  } catch (liveError) {
    const cached = await readCachedFixtures(input.sportId);
    if (cached.fixtures.length > 0) {
      return { ...cached, source: "cache" as const };
    }
    throw liveError;
  }
}

const CACHE_WRITE_CHUNK_SIZE = 200;

async function cacheFixtures(fixtures: Fixture[]): Promise<void> {
  if (fixtures.length === 0) return;
  const db = getDb();
  for (let i = 0; i < fixtures.length; i += CACHE_WRITE_CHUNK_SIZE) {
    const chunk = fixtures.slice(i, i + CACHE_WRITE_CHUNK_SIZE);
    try {
      await db
        .insert(oddsCache)
        .values(
          chunk.map((f) => ({
            fixtureId: f.fixtureId,
            sportId: f.sportId,
            tournamentId: f.tournamentId,
            participant1Id: f.participant1Id,
            participant2Id: f.participant2Id,
            participant1Name: f.participant1Name,
            participant2Name: f.participant2Name,
            startTime: new Date(f.startTime),
            statusId: f.statusId,
          })),
        )
        .onConflictDoUpdate({
          target: oddsCache.fixtureId,
          set: {
            sportId: sql`excluded.sport_id`,
            tournamentId: sql`excluded.tournament_id`,
            participant1Id: sql`excluded.participant1_id`,
            participant2Id: sql`excluded.participant2_id`,
            participant1Name: sql`excluded.participant1_name`,
            participant2Name: sql`excluded.participant2_name`,
            startTime: sql`excluded.start_time`,
            statusId: sql`excluded.status_id`,
            updatedAt: sql`now()`,
          },
        });
    } catch {
      // Best-effort backup — a DB hiccup shouldn't break the live response.
    }
  }
}

async function readCachedFixtures(
  sportId: string | undefined,
): Promise<{ fixtures: Fixture[]; cachedAt: string | undefined }> {
  try {
    const db = getDb();
    const rows = sportId
      ? await db.select().from(oddsCache).where(eq(oddsCache.sportId, sportId))
      : await db.select().from(oddsCache);
    const cachedAt = rows.reduce<Date | undefined>(
      (latest, r) => (!latest || r.updatedAt > latest ? r.updatedAt : latest),
      undefined,
    );
    return {
      fixtures: rows.map((r) => ({
        fixtureId: r.fixtureId,
        sportId: r.sportId,
        tournamentId: r.tournamentId ?? "",
        participant1Id: r.participant1Id ?? "",
        participant2Id: r.participant2Id ?? "",
        participant1Name: r.participant1Name ?? undefined,
        participant2Name: r.participant2Name ?? undefined,
        startTime: (r.startTime ?? r.updatedAt).toISOString(),
        statusId: r.statusId ?? undefined,
        bookmakerOdds: (r.bookmakerOdds as Fixture["bookmakerOdds"]) ?? undefined,
      })),
      cachedAt: cachedAt?.toISOString(),
    };
  } catch {
    return { fixtures: [], cachedAt: undefined };
  }
}
