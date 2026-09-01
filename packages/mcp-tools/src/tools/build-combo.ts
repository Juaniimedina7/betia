import { getDb, oddsCache } from "@bet/db";
import { getOddsPapiClient, type Fixture } from "@bet/oddspapi-client";
import { buildCombo as runComboSearch, extractCandidateLegs } from "@bet/combo-engine";
import { and, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { listTournaments } from "./list-tournaments";
import { toUserFacingError } from "../user-facing-error";

const MAX_TOURNAMENTS = 20;

export const buildComboInput = z.object({
  targetMultiplier: z.number().positive().optional(),
  targetLegCount: z.number().int().min(1).optional(),
  minLegs: z.number().int().min(1).optional(),
  maxLegs: z.number().int().min(1).optional(),
  sports: z.array(z.string()).optional(),
  tournamentIds: z.array(z.string()).optional(),
  excludeFixtureIds: z.array(z.string()).optional(),
  riskProfile: z.enum(["conservative", "balanced", "aggressive"]).optional(),
  tolerance: z.number().min(0).max(1).optional(),
});

export type BuildComboInput = z.infer<typeof buildComboInput>;

async function resolveTournamentIds(input: BuildComboInput): Promise<string[]> {
  if (input.tournamentIds && input.tournamentIds.length > 0) {
    return input.tournamentIds.slice(0, MAX_TOURNAMENTS);
  }

  if (input.sports && input.sports.length > 0) {
    const tournamentLists = await Promise.all(
      input.sports.map((sportId) => listTournaments({ sportId })),
    );
    return tournamentLists
      .flatMap(({ tournaments }) => tournaments)
      .map((t) => t.tournamentId)
      .slice(0, MAX_TOURNAMENTS);
  }

  throw new Error(
    "build_combo requires at least `tournamentIds` or `sports` to bound how many fixtures get fetched",
  );
}

export async function buildComboTool(input: BuildComboInput) {
  const tournamentIds = await resolveTournamentIds(input);
  if (tournamentIds.length === 0) {
    return {
      legs: [],
      combinedOddsDecimal: 0,
      legCount: 0,
      averageEdgePct: 0,
      toleranceMet: false,
      warning: "No se encontraron torneos para los filtros dados.",
    };
  }

  // OddsPapi requires exactly one bookmaker per call. To find edges across the market,
  // we fetch odds from several major bookmakers and merge them into a unified view.
  const BOOKMAKERS = ["pinnacle", "bet365", "1xbet", "draftkings", "betway", "bovada", "betfair"];
  
  const client = getOddsPapiClient();
  const allResponses = await Promise.allSettled(
    BOOKMAKERS.map((bookmaker) => client.getOddsByTournaments({ tournamentIds, bookmaker }))
  );
  
  const mergedFixtures = new Map<string, Fixture>();
  
  for (const res of allResponses) {
    if (res.status === "rejected") {
      continue; // Ignore single-bookmaker failures
    }
    for (const fixture of res.value) {
      const existing = mergedFixtures.get(fixture.fixtureId);
      if (existing) {
        if (fixture.bookmakerOdds) {
          existing.bookmakerOdds = {
            ...(existing.bookmakerOdds || {}),
            ...fixture.bookmakerOdds
          };
        }
      } else {
        // Deep clone so we don't mutate the raw response object directly when merging
        mergedFixtures.set(fixture.fixtureId, { 
          ...fixture, 
          bookmakerOdds: { ...(fixture.bookmakerOdds || {}) } 
        });
      }
    }
  }

  // All 7 live bookmaker calls failed (e.g. OddsPapi's monthly quota is exhausted) —
  // fall back to whatever /api/ingest/poll last wrote to odds_cache (pinnacle only,
  // refreshed twice daily) instead of failing the whole combo outright. Same pattern
  // as list-fixtures.ts's live-fetch + DB-cache fallback.
  if (mergedFixtures.size === 0) {
    const cached = await readCachedFixtures(tournamentIds);
    for (const fixture of cached) {
      mergedFixtures.set(fixture.fixtureId, fixture);
    }
  }

  if (mergedFixtures.size === 0) {
    const firstError = allResponses.find((r) => r.status === "rejected");
    if (firstError && firstError.status === "rejected") {
      throw toUserFacingError(firstError.reason);
    }
  }

  const fixtures = Array.from(mergedFixtures.values());
  const candidates = extractCandidateLegs(fixtures);

  return runComboSearch(candidates, {
    targetMultiplier: input.targetMultiplier,
    targetLegCount: input.targetLegCount,
    minLegs: input.minLegs,
    maxLegs: input.maxLegs,
    excludeFixtureIds: input.excludeFixtureIds,
    riskProfile: input.riskProfile,
    tolerance: input.tolerance,
  });
}

/** Best-effort read of odds_cache (written by /api/ingest/poll) — never throws. */
async function readCachedFixtures(tournamentIds: string[]): Promise<Fixture[]> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(oddsCache)
      .where(and(inArray(oddsCache.tournamentId, tournamentIds), isNotNull(oddsCache.bookmakerOdds)));
    return rows.map((r) => ({
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
    }));
  } catch {
    return [];
  }
}
