import { filterByRiskProfile, rankByEdge } from "./edge";
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

/**
 * MVP simplification: one candidate leg per fixture (the highest-edge one).
 * This makes the anti-correlation rule ("never two legs from the same
 * fixture") automatically satisfied by construction, at the cost of not
 * considering alternate markets on the same match.
 */
function bestLegPerFixture(legs: CandidateLeg[]): CandidateLeg[] {
  const byFixture = new Map<string, CandidateLeg>();
  for (const leg of rankByEdge(legs)) {
    if (!byFixture.has(leg.fixtureId)) byFixture.set(leg.fixtureId, leg);
  }
  return [...byFixture.values()];
}

function greedyForCount(
  pool: CandidateLeg[],
  legCount: number,
  targetLog: number,
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
        if (selection.some((leg) => leg.fixtureId === candidate.fixtureId)) continue;
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
 * Deterministic search for a combo hitting a target multiplier (or leg
 * count) within tolerance, ranked by edge. The LLM never runs this — it only
 * supplies `constraints` from natural language, and narrates this function's
 * output. See packages/mcp-tools/src/tools/build-combo.ts for the tool wrapper.
 */
export function buildCombo(allCandidates: CandidateLeg[], constraints: BuildComboConstraints): ComboResult {
  const excluded = new Set(constraints.excludeFixtureIds ?? []);
  const riskProfile = constraints.riskProfile ?? "balanced";
  const tolerance = constraints.tolerance ?? DEFAULT_TOLERANCE;

  const pool = rankByEdge(
    filterByRiskProfile(
      bestLegPerFixture(allCandidates.filter((leg) => !excluded.has(leg.fixtureId))),
      riskProfile,
    ),
  );

  if (pool.length === 0) {
    return {
      legs: [],
      combinedOddsDecimal: 0,
      legCount: 0,
      averageEdgePct: 0,
      toleranceMet: false,
      warning: "No hay patas candidatas disponibles con los filtros dados.",
    };
  }

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
    const attempt = greedyForCount(pool, legCount, targetLog);
    if (!attempt) continue;
    const diffAbs = Math.abs(targetLog - attempt.log);
    if (diffAbs < bestDiffAbs) {
      bestDiffAbs = diffAbs;
      best = attempt;
    }
  }

  if (!best) {
    return {
      legs: [],
      combinedOddsDecimal: 0,
      legCount: 0,
      averageEdgePct: 0,
      toleranceMet: false,
      warning: "No se pudo armar un combo con la cantidad de patas disponibles.",
    };
  }

  const finalOdds = combinedOdds(best.legs);
  const relativeDiff = Math.abs(finalOdds - targetMultiplier) / targetMultiplier;
  const toleranceMet = relativeDiff <= tolerance;

  return {
    legs: best.legs,
    combinedOddsDecimal: finalOdds,
    legCount: best.legs.length,
    averageEdgePct: averageEdge(best.legs),
    toleranceMet,
    warning: toleranceMet
      ? undefined
      : `No se encontró un combo dentro de ±${Math.round(tolerance * 100)}% del objetivo ${targetMultiplier}x; el más cercano da ${finalOdds.toFixed(2)}x.`,
  };
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
