import { bestProbabilityEstimate, filterByRiskProfile, MIN_PROBABILITY_BY_PROFILE, rankByConfidence } from "./edge";
import { marketFamilyOf } from "./market-families";
import type { BuildComboConstraints, CandidateLeg, ComboResult } from "./types";

const DEFAULT_MIN_LEGS = 2;
const DEFAULT_MAX_LEGS = 10;
const DEFAULT_TOLERANCE = 0.15;
const LOCAL_SEARCH_ITERATIONS = 200;
/** Caps the swap-candidate pool per leg count to keep search bounded on large candidate sets. */
const CANDIDATE_POOL_MULTIPLIER = 6;

function averageEdge(legs: CandidateLeg[]): number {
  if (legs.length === 0) return 0;
  return legs.reduce((sum, leg) => sum + leg.edgePct, 0) / legs.length;
}

function combinedOdds(legs: CandidateLeg[]): number {
  return legs.reduce((product, leg) => product * leg.priceDecimal, 1);
}

function averageStatisticalProbability(legs: CandidateLeg[]): number | undefined {
  const withStats = legs.filter((leg) => leg.statisticalProbability !== undefined);
  if (withStats.length === 0) return undefined;
  return withStats.reduce((sum, leg) => sum + leg.statisticalProbability!, 0) / withStats.length;
}

/** Same "real chance of hitting" per leg as `bestProbabilityEstimate` (statistical when
 * available, else market-implied fair probability), averaged — unlike
 * `averageStatisticalProbability` this is always defined (fairProbability always
 * exists), so it's what the probability-floor fallback below reports as "the highest
 * we could actually get" when the requested floor is unreachable. */
function averageRealProbability(legs: CandidateLeg[]): number {
  return legs.reduce((sum, leg) => sum + bestProbabilityEstimate(leg), 0) / legs.length;
}

/**
 * One candidate leg per conflict key (the most-likely-to-hit one, by statistical
 * probability when available, falling back to market edge otherwise). `conflictKey`
 * is `fixtureId` for the normal cross-fixture search (`buildCombo`) — "never two legs
 * from the same fixture" — or a market-family key for the same-match search
 * (`buildSameMatchCombo`) — "never two legs answering the same underlying question."
 */
function bestLegPerConflictKey(legs: CandidateLeg[], conflictKey: (leg: CandidateLeg) => string): CandidateLeg[] {
  const byKey = new Map<string, CandidateLeg>();
  for (const leg of rankByConfidence(legs)) {
    const key = conflictKey(leg);
    if (!byKey.has(key)) byKey.set(key, leg);
  }
  return [...byKey.values()];
}

function greedyForCount(
  pool: CandidateLeg[],
  legCount: number,
  targetLog: number,
  conflictKey: (leg: CandidateLeg) => string,
): { legs: CandidateLeg[]; log: number } | null {
  if (pool.length < legCount) return null;

  const searchPool = pool.slice(0, Math.min(pool.length, legCount * CANDIDATE_POOL_MULTIPLIER));
  let selection = searchPool.slice(0, legCount);
  let currentLog = selection.reduce((sum, leg) => sum + Math.log(leg.priceDecimal), 0);

  for (let i = 0; i < LOCAL_SEARCH_ITERATIONS; i++) {
    const diff = targetLog - currentLog;
    if (Math.abs(diff) < 0.01) break; // close enough in log-space, stop refining

    let bestSwap: { outIdx: number; candidate: CandidateLeg; newLog: number } | null = null;
    let bestDiffAbs = Math.abs(diff);

    for (let outIdx = 0; outIdx < selection.length; outIdx++) {
      const outLeg = selection[outIdx]!;
      const logWithoutOut = currentLog - Math.log(outLeg.priceDecimal);

      for (const candidate of searchPool) {
        if (selection.some((leg) => conflictKey(leg) === conflictKey(candidate))) continue;
        const newLog = logWithoutOut + Math.log(candidate.priceDecimal);
        const newDiffAbs = Math.abs(targetLog - newLog);
        if (newDiffAbs < bestDiffAbs) {
          bestDiffAbs = newDiffAbs;
          bestSwap = { outIdx, candidate, newLog };
        }
      }
    }

    if (!bestSwap) break; // no improving swap available

    selection = selection.map((leg, idx) => (idx === bestSwap!.outIdx ? bestSwap!.candidate : leg));
    currentLog = bestSwap.newLog;
  }

  return { legs: selection, log: currentLog };
}

/**
 * Deterministic search for a combo hitting a target multiplier (or leg count) within
 * tolerance, ranked by edge. Shared by `buildCombo` (cross-fixture, one leg per
 * fixture) and `buildSameMatchCombo` (one fixture, one leg per market family) — the
 * only difference between the two public entry points is which `conflictKey` they
 * pass in.
 */
function runSearch(
  allCandidates: CandidateLeg[],
  constraints: BuildComboConstraints,
  conflictKey: (leg: CandidateLeg) => string,
): ComboResult {
  const excluded = new Set(constraints.excludeFixtureIds ?? []);
  const riskProfile = constraints.riskProfile ?? "balanced";
  // The probability floor is keyed by riskProfile (see MIN_PROBABILITY_BY_PROFILE in
  // ./edge.ts) — but when the caller didn't pick a riskProfile at all, it resolves
  // against "conservative" specifically (0.8), not "balanced" (0.25): no stated risk
  // preference should still default to the safe probability, even though the edge
  // floor above keeps defaulting to balanced's -3% (needed to hit multiplier targets).
  const minProbability = constraints.minProbability ?? MIN_PROBABILITY_BY_PROFILE[constraints.riskProfile ?? "conservative"];
  const tolerance = constraints.tolerance ?? DEFAULT_TOLERANCE;

  const deduped = bestLegPerConflictKey(
    allCandidates.filter((leg) => !excluded.has(leg.fixtureId)),
    conflictKey,
  );

  // Edge floor only (minProbability=0) — isolates whether the requested PROBABILITY
  // floor specifically is what's unreachable, as opposed to the edge floor (a much
  // rarer, separate failure mode — real cached edges are almost never below -8%,
  // "aggressive"'s own floor).
  const edgeFilteredPool = filterByRiskProfile(deduped, riskProfile, 0);

  if (edgeFilteredPool.length === 0) {
    return {
      legs: [],
      combinedOddsDecimal: 0,
      legCount: 0,
      averageEdgePct: 0,
      toleranceMet: false,
      warning: `No hay patas candidatas que cumplan el piso de edge del perfil "${riskProfile}" para esos filtros.`,
    };
  }

  const probFilteredPool = filterByRiskProfile(edgeFilteredPool, riskProfile, minProbability);

  // The requested probability floor has no leg that clears it — rather than a flat
  // empty result, fall back to the highest-probability legs actually available (still
  // respecting the edge floor and every other constraint) and say so explicitly. See
  // CLAUDE.md's "build_combo falls back to the highest achievable probability" section.
  const probabilityUnreachable = probFilteredPool.length === 0;
  const pool = rankByConfidence(probabilityUnreachable ? edgeFilteredPool : probFilteredPool);

  const targetMultiplier = constraints.targetMultiplier ?? deriveTargetFromLegCount(pool, constraints);
  const targetLog = Math.log(targetMultiplier);
  const minLegs = constraints.minLegs ?? DEFAULT_MIN_LEGS;
  const maxLegs = Math.min(constraints.maxLegs ?? DEFAULT_MAX_LEGS, pool.length);

  const legCounts = constraints.targetLegCount
    ? [constraints.targetLegCount]
    : rangeInclusive(minLegs, maxLegs);

  let best: { legs: CandidateLeg[]; log: number } | null = null;
  let bestDiffAbs = Infinity;

  for (const legCount of legCounts) {
    const attempt = greedyForCount(pool, legCount, targetLog, conflictKey);
    if (!attempt) continue;
    const diffAbs = Math.abs(targetLog - attempt.log);
    if (diffAbs < bestDiffAbs) {
      bestDiffAbs = diffAbs;
      best = attempt;
    }
  }

  const probabilityFloorPct = Math.round(minProbability * 100);
  const unreachableFloorNotice = `No hay patas con al menos ${probabilityFloorPct}% de probabilidad real (perfil "${riskProfile}") para esos filtros`;

  if (!best) {
    return {
      legs: [],
      combinedOddsDecimal: 0,
      legCount: 0,
      averageEdgePct: 0,
      toleranceMet: false,
      warning: probabilityUnreachable
        ? `${unreachableFloorNotice}, y tampoco se pudo armar un combo con la cantidad de patas disponibles usando las de mayor probabilidad real.`
        : "No se pudo armar un combo con la cantidad de patas disponibles.",
    };
  }

  const finalOdds = combinedOdds(best.legs);
  const relativeDiff = Math.abs(finalOdds - targetMultiplier) / targetMultiplier;
  const toleranceMet = relativeDiff <= tolerance;

  // Requested probability floor was unreachable: this combo is the highest-real-
  // probability one that still meets every other requirement (target multiplier, leg
  // count, edge floor) — say so explicitly rather than silently substituting it, per
  // CLAUDE.md's "build_combo falls back to the highest achievable probability" note.
  const probabilityFallbackNotice = probabilityUnreachable
    ? `${unreachableFloorNotice} — esta es la combinada con la mayor probabilidad real posible que cumple el resto de los requisitos (~${Math.round(averageRealProbability(best.legs) * 100)}% promedio real en las patas elegidas).`
    : undefined;
  const toleranceWarning = toleranceMet
    ? undefined
    : `No se encontró un combo dentro de ±${Math.round(tolerance * 100)}% del objetivo ${targetMultiplier}x; el más cercano da ${finalOdds.toFixed(2)}x.`;

  return {
    legs: best.legs,
    combinedOddsDecimal: finalOdds,
    legCount: best.legs.length,
    averageEdgePct: averageEdge(best.legs),
    averageStatisticalProbability: averageStatisticalProbability(best.legs),
    toleranceMet,
    warning: [probabilityFallbackNotice, toleranceWarning].filter((w): w is string => !!w).join(" ") || undefined,
  };
}

/**
 * Cross-fixture combo search — never two legs from the same fixture. The LLM never
 * runs this — it only supplies `constraints` from natural language, and narrates this
 * function's output. See packages/mcp-tools/src/tools/build-combo.ts for the tool
 * wrapper.
 */
export function buildCombo(allCandidates: CandidateLeg[], constraints: BuildComboConstraints): ComboResult {
  return runSearch(allCandidates, constraints, (leg) => leg.fixtureId);
}

/**
 * Same-match combo search: `allCandidates` should already be every market's legs for
 * ONE fixture (e.g. `extractCandidateLegs([event])`) — never two legs from the same
 * market family (see market-families.ts), instead of never two legs from the same
 * fixture. Caller (build-combo.ts's `fixtureId` branch) is responsible for always
 * surfacing a correlation disclaimer alongside this result: the combined odds here are
 * a naive product-of-independent-prices, same as buildCombo, but same-match markets
 * are NOT independent in reality (e.g. Over 2.5 goals and Both Teams Score correlate
 * positively) — nothing in this engine adjusts for that.
 */
export function buildSameMatchCombo(allCandidates: CandidateLeg[], constraints: BuildComboConstraints): ComboResult {
  return runSearch(allCandidates, constraints, (leg) => marketFamilyOf(leg.marketId));
}

function deriveTargetFromLegCount(pool: CandidateLeg[], constraints: BuildComboConstraints): number {
  const legCount = constraints.targetLegCount ?? DEFAULT_MIN_LEGS;
  const topLegs = pool.slice(0, legCount);
  return combinedOdds(topLegs) || 2;
}

function rangeInclusive(from: number, to: number): number[] {
  const result: number[] = [];
  for (let n = from; n <= to; n++) result.push(n);
  return result;
}
