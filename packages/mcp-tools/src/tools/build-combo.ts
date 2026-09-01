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

  // odds_cache is the primary source: /api/ingest/poll already refreshes it daily
  // across multiple bookmakers (Pinnacle + at least one more, so de-vig/edge math has
  // something to compare against), so most requests are answered without spending any
  // of OddsPapi's monthly quota. Only fall back to live calls when the requested
  // tournaments aren't covered there yet (off-watchlist tournaments, or a cold cache).
  const mergedFixtures = new Map<string, Fixture>();
  for (const fixture of await readCachedFixtures(tournamentIds)) {
    mergedFixtures.set(fixture.fixtureId, fixture);
  }

  if (mergedFixtures.size === 0) {
    // OddsPapi requires exactly one bookmaker per call. To find edges across the
    // market, fetch odds from a few bookmakers live and merge them into one view —
    // mirrors the same book list the ingest cron polls, so a cold cache and a live
    // fetch produce comparable edge quality.
    const BOOKMAKERS = ["pinnacle", "bet365"];

    const client = getOddsPapiClient();
    const allResponses = await Promise.allSettled(
      BOOKMAKERS.map((bookmaker) => client.getOddsByTournaments({ tournamentIds, bookmaker }))
    );

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

    if (mergedFixtures.size === 0) {
      const firstError = allResponses.find((r) => r.status === "rejected");
      if (firstError && firstError.status === "rejected") {
        throw toUserFacingError(firstError.reason);
      }
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
