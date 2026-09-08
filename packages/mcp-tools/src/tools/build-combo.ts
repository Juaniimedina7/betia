import { getDb, oddsCache, sportsCache } from "@bet/db";
import type { Event } from "@bet/odds-api-client";
import {
  buildCombo as runComboSearch,
  buildSameMatchCombo as runSameMatchComboSearch,
  extractCandidateLegs,
  type CandidateLeg,
  type ComboResult,
} from "@bet/combo-engine";
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { hasFixtureStarted, notStartedCondition } from "../fixture-time";
import { resolveByName } from "../fuzzy-match";
import { estimateMatchProbabilitiesBatch, fixtureKey, type StatisticalProbabilityResult } from "../statistical-probability";

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
  // Scopes the whole search to ONE fixture instead of many — "un combo con eventos de
  // este partido" (hándicap + más/menos + ambos anotan del mismo match, not one leg
  // per match). Mutually exclusive in practice with sports/sportKeys/from/to (ignored
  // when fixtureId is set, since there's only one fixture to consider). In this mode
  // the normal "never two legs from the same fixture" rule doesn't apply (every leg
  // IS from the same fixture, by design) — instead at most one leg per market family
  // is allowed (see MARKET_FAMILY in packages/combo-engine), and the result always
  // carries a `disclaimer`: same-match legs are correlated in reality (e.g. Over 2.5
  // goals and Both Teams Score tend to happen together) and this engine's combined
  // odds is a naive product-of-independent-prices that does NOT account for that —
  // always relay the disclaimer to the user, don't drop it.
  fixtureId: z.string().optional(),
  // ISO 8601 kickoff-time window (UTC). Without these, every cached fixture for the
  // resolved sport_keys is a candidate regardless of when it kicks off — a fixture 2
  // weeks out is just as eligible as one tonight. Pass both to scope to "hoy"/"esta
  // semana"/etc; the caller (the agent) is responsible for computing the actual
  // boundaries since this tool has no notion of "today" on its own. Independently of
  // these, a fixture whose kickoff has already passed is always excluded (see
  // notStartedCondition in ../fixture-time) — from/to only narrow the future window,
  // they can never pull in an already-started match.
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
  // "conservative": still +EV (>=0% edge) AND >=80% real chance of hitting (statistical
  // when available, else market-implied) — low-variance picks, not just well-priced
  // ones. "balanced" (default): edge >= -3%, no probability floor. "aggressive": edge
  // >= -8%, no probability floor. Map "perfil conservador/moderado/agresivo" (or
  // synonyms like "seguro"/"arriesgado") from the user's request to this parameter —
  // omitting it silently falls back to "balanced".
  riskProfile: z
    .enum(["conservative", "balanced", "aggressive"])
    .optional()
    .describe(
      "Risk profile for leg selection. 'conservative' = still +EV (edge >=0%) AND >=80% real chance of hitting (low-variance, high-confidence picks). 'balanced' (default) = edge >= -3%, no probability floor. 'aggressive' = edge >= -8%, no probability floor. Map the user's requested risk level (e.g. Spanish 'perfil conservador/moderado/agresivo', 'seguro', 'arriesgado') onto this — don't leave it unset if the user expressed a risk preference, since omitting it silently defaults to 'balanced'.",
    ),
  tolerance: z.number().min(0).max(1).optional(),
});

export type BuildComboInput = z.infer<typeof buildComboInput>;

/**
 * Batches the real Poisson statistical-probability lookup for every h2h event in one
 * shot (one teamSeasonStats query per league, not per leg or per bookmaker) — computed
 * once from the raw cached events, since it doesn't depend on which bookmaker prices
 * a leg. Events on unmapped sports (NBA/NFL/tennis) or without enough historical data
 * are simply absent from the returned map, same as estimate_match_probability's
 * existing available:false behavior.
 */
async function fetchStatisticalProbabilities(events: Event[]): Promise<Map<string, StatisticalProbabilityResult>> {
  const fixtures = [
    ...new Map(
      events
        .filter((e) => e.homeTeam && e.awayTeam)
        .map((e) => {
          const fixture = { sportKey: e.sportKey, homeTeam: e.homeTeam, awayTeam: e.awayTeam };
          return [fixtureKey(fixture), fixture] as const;
        }),
    ).values(),
  ];
  if (fixtures.length === 0) return new Map();
  return estimateMatchProbabilitiesBatch(fixtures);
}

/**
 * Maps each h2h candidate leg to its specific outcome's statistical probability
 * (home/draw/away). Legs on other markets (spreads/totals) or fixtures absent from
 * `estimates` (unmapped sport, insufficient data) are returned unchanged —
 * statisticalProbability stays undefined, completely distinct from `fairProbability`'s
 * market-implied de-vig number.
 */
function applyStatisticalProbabilities(
  candidates: CandidateLeg[],
  estimates: Map<string, StatisticalProbabilityResult>,
): CandidateLeg[] {
  if (estimates.size === 0) return candidates;

  return candidates.map((leg) => {
    if (leg.marketId !== "h2h" || !leg.homeTeam || !leg.awayTeam) return leg;
    const estimate = estimates.get(fixtureKey({ sportKey: leg.sportKey, homeTeam: leg.homeTeam, awayTeam: leg.awayTeam }));
    if (!estimate) return leg;

    let statisticalProbability: number | undefined;
    if (leg.outcomeName === leg.homeTeam) statisticalProbability = estimate.homeWinProb;
    else if (leg.outcomeName === leg.awayTeam) statisticalProbability = estimate.awayWinProb;
    else if (leg.outcomeName === "Draw") statisticalProbability = estimate.drawProb;

    return statisticalProbability === undefined ? leg : { ...leg, statisticalProbability };
  });
}

function emptyResult(warning: string): ComboResult {
  return { legs: [], combinedOddsDecimal: 0, legCount: 0, averageEdgePct: 0, toleranceMet: false, warning };
}

const SAME_MATCH_DISCLAIMER =
  "Estas cuotas combinan varios mercados del mismo partido, que en la realidad están correlacionados (ej. \"Más de 2.5 goles\" y \"Ambos anotan\" tienden a darse juntos) — el multiplicador mostrado multiplica las cuotas como si fueran independientes, así que es una estimación optimista, no el precio real de una \"combinada del mismo partido\" que ofrecería una casa de apuestas.";

function relativeDiffToTarget(result: ComboResult, targetMultiplier?: number): number {
  if (!targetMultiplier || result.combinedOddsDecimal <= 0) return 0;
  return Math.abs(result.combinedOddsDecimal - targetMultiplier) / targetMultiplier;
}

/**
 * Orders two same-shape combo attempts (one per candidate bookmaker) to pick the single
 * best one: hitting the requested multiplier tolerance beats not hitting it, then closer
 * to the target multiplier wins, then higher real statistical probability (the "highest
 * chance of actually happening" the combo should be optimizing for) wins, then higher
 * market edge as the final tiebreaker. Negative return means `a` is better than `b`.
 */
function compareComboResults(a: ComboResult, b: ComboResult, targetMultiplier?: number): number {
  if (a.toleranceMet !== b.toleranceMet) return a.toleranceMet ? -1 : 1;
  const diffA = relativeDiffToTarget(a, targetMultiplier);
  const diffB = relativeDiffToTarget(b, targetMultiplier);
  if (diffA !== diffB) return diffA - diffB;
  const statA = a.averageStatisticalProbability ?? -1;
  const statB = b.averageStatisticalProbability ?? -1;
  if (statA !== statB) return statB - statA;
  return b.averageEdgePct - a.averageEdgePct;
}

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
 *
 * Every leg in the returned combo always comes from a single bookmaker, so the user can
 * actually place the real bet there — never a mix. If `bookmaker` is given, that's the
 * one book used (unchanged behavior). Otherwise this tries every bookmaker present in
 * the cached events and keeps whichever produces the best combo (see
 * compareComboResults): closest to the target multiplier, then highest real statistical
 * probability, then highest market edge.
 */
export async function buildComboTool(input: BuildComboInput): Promise<ComboResult> {
  if (input.fixtureId) {
    const result = await buildSameMatchComboTool(input, input.fixtureId);
    return { ...result, disclaimer: SAME_MATCH_DISCLAIMER };
  }

  const sportKeys = await resolveSportKeys(input);
  if (sportKeys.length === 0) {
    return emptyResult("No se encontraron torneos para los filtros dados.");
  }

  const events = await readCachedEvents(sportKeys, input.from, input.to);
  if (events.length === 0) {
    return emptyResult(
      input.from || input.to
        ? "No hay partidos cacheados para esos torneos en el rango de fechas pedido."
        : "No hay partidos cacheados para esos torneos.",
    );
  }

  const constraints = {
    targetMultiplier: input.targetMultiplier,
    targetLegCount: input.targetLegCount,
    minLegs: input.minLegs,
    maxLegs: input.maxLegs,
    excludeFixtureIds: input.excludeFixtureIds,
    riskProfile: input.riskProfile,
    tolerance: input.tolerance,
  };

  const statisticalProbabilities = await fetchStatisticalProbabilities(events);

  if (input.bookmaker) {
    const cachedBookmakers = [...new Set(events.flatMap((e) => Object.keys(e.bookmakerOdds)))];
    const resolvedBookmaker = resolveByName(input.bookmaker, cachedBookmakers);

    if (!resolvedBookmaker) {
      return emptyResult(
        `No tenemos cuotas cacheadas de "${input.bookmaker}" — las casas disponibles ahora son: ${cachedBookmakers.join(", ") || "ninguna"}.`
      );
    }

    const candidates = applyStatisticalProbabilities(
      extractCandidateLegs(events, { bookmaker: resolvedBookmaker }),
      statisticalProbabilities,
    );
    
    if (candidates.length === 0) {
      return emptyResult(`No hay cuotas de "${resolvedBookmaker}" para ningún partido que cumpla los demás filtros.`);
    }
    return runComboSearch(candidates, constraints);
  }

  const candidateBookmakers = [...new Set(events.flatMap((e) => Object.keys(e.bookmakerOdds)))];
  if (candidateBookmakers.length === 0) {
    return emptyResult("No hay casas de apuestas cacheadas para esos torneos.");
  }

  let best: ComboResult | null = null;
  for (const bookmaker of candidateBookmakers) {
    const candidates = applyStatisticalProbabilities(
      extractCandidateLegs(events, { bookmaker }),
      statisticalProbabilities,
    );
    if (candidates.length === 0) continue;
    const result = runComboSearch(candidates, constraints);
    if (result.legs.length === 0) continue;
    if (!best || compareComboResults(result, best, input.targetMultiplier) < 0) best = result;
  }

  if (!best) {
    return emptyResult(
      `Ninguna casa cacheada (${candidateBookmakers.join(", ")}) tiene suficientes patas para armar un combo con esos filtros.`,
    );
  }
  return best;
}

// A correct/exact scoreline determines essentially every other market for its scope
// (who won, by how much, total goals, both-teams-score, odd/even goals, ...) — it would
// need to conflict with several different MARKET_FAMILY families at once, which the
// single-family-key model in combo-engine can't express. Rather than force that in,
// exclude these from same-match combo candidates outright (same reasoning already
// applied to exact_score for a different reason — see market-labels.ts's comment on
// why it's excluded from the curated chat set — this is a second, independent reason
// to keep it out of THIS particular path).
const SCORE_EXHAUSTIVE_MARKETS = new Set(["exact_score", "correct_score_first_half", "correct_score_second_half"]);

function extractSameMatchCandidateLegs(event: Event, options: { bookmaker: string }): CandidateLeg[] {
  return extractCandidateLegs([event], options).filter((leg) => !SCORE_EXHAUSTIVE_MARKETS.has(leg.marketId));
}

/**
 * The `fixtureId` branch: same shape as buildComboTool's normal cross-fixture path
 * (same-bookmaker-for-the-whole-combo rule, same "try every bookmaker, keep the best"
 * fallback when none is given) but scoped to one event and searched with
 * `buildSameMatchCombo` (at most one leg per market family, not per fixture — every
 * leg here already shares the same fixtureId). The disclaimer is attached by the
 * caller (buildComboTool), not here, so it's attached exactly once regardless of which
 * return path below is taken.
 */
async function buildSameMatchComboTool(input: BuildComboInput, fixtureId: string): Promise<ComboResult> {
  const cached = await readCachedEvent(fixtureId);
  if (!cached) {
    return emptyResult(`No hay cuotas cacheadas para el partido "${fixtureId}".`);
  }
  if (cached.hasStarted) {
    return emptyResult(
      `El partido "${fixtureId}" ya arrancó — no se arman combinadas de mercados de un partido que ya empezó.`,
    );
  }
  const event = cached.event;

  const constraints = {
    targetMultiplier: input.targetMultiplier,
    targetLegCount: input.targetLegCount,
    minLegs: input.minLegs,
    maxLegs: input.maxLegs,
    riskProfile: input.riskProfile,
    tolerance: input.tolerance,
  };

  const statisticalProbabilities = await fetchStatisticalProbabilities([event]);
  const cachedBookmakers = Object.keys(event.bookmakerOdds);
  if (cachedBookmakers.length === 0) {
    return emptyResult(`No hay casas de apuestas cacheadas para el partido "${fixtureId}".`);
  }

  if (input.bookmaker) {
    const resolvedBookmaker = resolveByName(input.bookmaker, cachedBookmakers);
    if (!resolvedBookmaker) {
      return emptyResult(
        `No tenemos cuotas cacheadas de "${input.bookmaker}" para este partido — las casas disponibles son: ${cachedBookmakers.join(", ")}.`,
      );
    }
    const candidates = applyStatisticalProbabilities(
      extractSameMatchCandidateLegs(event, { bookmaker: resolvedBookmaker }),
      statisticalProbabilities,
    );
    if (candidates.length === 0) {
      return emptyResult(`No hay cuotas de "${resolvedBookmaker}" para ningún mercado de este partido.`);
    }
    return runSameMatchComboSearch(candidates, constraints);
  }

  let best: ComboResult | null = null;
  for (const bookmaker of cachedBookmakers) {
    const candidates = applyStatisticalProbabilities(
      extractSameMatchCandidateLegs(event, { bookmaker }),
      statisticalProbabilities,
    );
    if (candidates.length === 0) continue;
    const result = runSameMatchComboSearch(candidates, constraints);
    if (result.legs.length === 0) continue;
    if (!best || compareComboResults(result, best, input.targetMultiplier) < 0) best = result;
  }

  if (!best) {
    return emptyResult(
      `Ninguna casa cacheada (${cachedBookmakers.join(", ")}) tiene suficientes mercados distintos para armar un combo de este partido.`,
    );
  }
  return best;
}

/** Best-effort read of odds_cache (written by /api/ingest/poll) — never throws. */
async function readCachedEvents(sportKeys: string[], from?: string, to?: string): Promise<Event[]> {
  try {
    const db = getDb();
    const conditions = [inArray(oddsCache.sportKey, sportKeys), isNotNull(oddsCache.bookmakerOdds), notStartedCondition()];
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

/** Single-fixture counterpart to readCachedEvents, for the fixtureId branch. Flags
 * (rather than excludes) an already-started fixture — the caller decides what to do. */
async function readCachedEvent(fixtureId: string): Promise<{ event: Event; hasStarted: boolean } | null> {
  try {
    const db = getDb();
    const [row] = await db.select().from(oddsCache).where(eq(oddsCache.eventId, fixtureId)).limit(1);
    if (!row?.bookmakerOdds) return null;
    return {
      event: {
        eventId: row.eventId,
        sportKey: row.sportKey,
        sportTitle: row.sportTitle ?? undefined,
        commenceTime: (row.commenceTime ?? row.updatedAt).toISOString(),
        homeTeam: row.homeTeam ?? "",
        awayTeam: row.awayTeam ?? "",
        bookmakerOdds: row.bookmakerOdds as Event["bookmakerOdds"],
      },
      hasStarted: hasFixtureStarted(row.commenceTime, row.updatedAt),
    };
  } catch {
    return null;
  }
}
