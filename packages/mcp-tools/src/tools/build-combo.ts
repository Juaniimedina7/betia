import { getDb, oddsCache, sportsCache } from "@bet/db";
import type { Event } from "@bet/odds-api-client";
import { buildCombo as runComboSearch, extractCandidateLegs } from "@bet/combo-engine";
import { and, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";

const MAX_SPORT_KEYS = 20;

export const buildComboInput = z.object({
  targetMultiplier: z.number().positive().optional(),
  targetLegCount: z.number().int().min(1).optional(),
  minLegs: z.number().int().min(1).optional(),
  maxLegs: z.number().int().min(1).optional(),
  // A group like "Soccer" (list_sports' output) — resolved to whichever sport_keys
  // within that group odds_cache actually has coverage for.
  sports: z.array(z.string()).optional(),
  // Sport_key strings directly (e.g. "soccer_epl") — list_tournaments' output.
  sportKeys: z.array(z.string()).optional(),
  // ISO 8601 kickoff-time window (UTC). Without these, every cached fixture for the
  // resolved sport_keys is a candidate regardless of when it kicks off — a fixture 2
  // weeks out is just as eligible as one tonight. Pass both to scope to "hoy"/"esta
  // semana"/etc; the caller (the agent) is responsible for computing the actual
  // boundaries since this tool has no notion of "today" on its own.
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  // Restricts every leg's bettable price to this one bookmaker (case-insensitive,
  // e.g. "pinnacle"/"unibet" — whatever /api/ingest/poll actually caches; see
  // DEFAULT_BOOKMAKERS in apps/web/app/api/ingest/poll/route.ts). Without it, each
  // leg shops for the best price across every cached bookmaker for that outcome —
  // legs in one combo can end up from different books. The fair-price reference used
  // for edge is NOT restricted (still Pinnacle-or-median across the full pool), so
  // edge still means "this book's price vs. the real consensus line."
  bookmaker: z.string().optional(),
  excludeFixtureIds: z.array(z.string()).optional(),
  riskProfile: z.enum(["conservative", "balanced", "aggressive"]).optional(),
  tolerance: z.number().min(0).max(1).optional(),
});

export type BuildComboInput = z.infer<typeof buildComboInput>;

async function resolveSportKeys(input: BuildComboInput): Promise<string[]> {
  if (input.sportKeys && input.sportKeys.length > 0) {
    return input.sportKeys.slice(0, MAX_SPORT_KEYS);
  }

  if (input.sports && input.sports.length > 0) {
    const db = getDb();
    const groupRows = await db
      .select({ sportKey: sportsCache.sportKey })
      .from(sportsCache)
      .where(inArray(sportsCache.group, input.sports));
    const sportKeysInGroup = groupRows.map((r) => r.sportKey);
    if (sportKeysInGroup.length === 0) return [];

    const cachedRows = await db
      .selectDistinct({ sportKey: oddsCache.sportKey })
      .from(oddsCache)
      .where(and(inArray(oddsCache.sportKey, sportKeysInGroup), isNotNull(oddsCache.bookmakerOdds)));
    return cachedRows.map((r) => r.sportKey).slice(0, MAX_SPORT_KEYS);
  }

  throw new Error(
    "build_combo requires at least `sportKeys` or `sports` to bound how many fixtures get fetched",
  );
}

/**
 * Cache-only, full stop — no live fallback (removed 2026-09-02 along with the
 * OddsPapi->The Odds API migration). A cold/off-watchlist sport_key just returns the
 * empty-result shape below rather than triggering a live call from a user-facing agent
 * request; /api/ingest/poll is the only place allowed to call the odds API live.
 */
export async function buildComboTool(input: BuildComboInput) {
  const sportKeys = await resolveSportKeys(input);
  if (sportKeys.length === 0) {
    return {
      legs: [],
      combinedOddsDecimal: 0,
      legCount: 0,
      averageEdgePct: 0,
      toleranceMet: false,
      warning: "No se encontraron torneos para los filtros dados.",
    };
  }

  const events = await readCachedEvents(sportKeys, input.from, input.to);
  if (events.length === 0) {
    return {
      legs: [],
      combinedOddsDecimal: 0,
      legCount: 0,
      averageEdgePct: 0,
      toleranceMet: false,
      warning:
        input.from || input.to
          ? "No hay partidos cacheados para esos torneos en el rango de fechas pedido."
          : "No hay partidos cacheados para esos torneos.",
    };
  }
  const candidates = extractCandidateLegs(events, { bookmaker: input.bookmaker });

  if (candidates.length === 0 && input.bookmaker) {
    const cachedBookmakers = [...new Set(events.flatMap((e) => Object.keys(e.bookmakerOdds)))];
    const isCached = cachedBookmakers.some((b) => b.toLowerCase() === input.bookmaker!.toLowerCase());
    return {
      legs: [],
      combinedOddsDecimal: 0,
      legCount: 0,
      averageEdgePct: 0,
      toleranceMet: false,
      warning: isCached
        ? `No hay cuotas de "${input.bookmaker}" para ningún partido que cumpla los demás filtros.`
        : `No tenemos cuotas cacheadas de "${input.bookmaker}" — las casas disponibles ahora son: ${cachedBookmakers.join(", ") || "ninguna"}.`,
    };
  }

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
async function readCachedEvents(sportKeys: string[], from?: string, to?: string): Promise<Event[]> {
  try {
    const db = getDb();
    const conditions = [inArray(oddsCache.sportKey, sportKeys), isNotNull(oddsCache.bookmakerOdds)];
    if (from) conditions.push(gte(oddsCache.commenceTime, new Date(from)));
    if (to) conditions.push(lte(oddsCache.commenceTime, new Date(to)));
    const rows = await db
      .select()
      .from(oddsCache)
      .where(and(...conditions));
    return rows.map((r) => ({
      eventId: r.eventId,
      sportKey: r.sportKey,
      sportTitle: r.sportTitle ?? undefined,
      commenceTime: (r.commenceTime ?? r.updatedAt).toISOString(),
      homeTeam: r.homeTeam ?? "",
      awayTeam: r.awayTeam ?? "",
      bookmakerOdds: (r.bookmakerOdds as Event["bookmakerOdds"]) ?? {},
    }));
  } catch {
    return [];
  }
}
