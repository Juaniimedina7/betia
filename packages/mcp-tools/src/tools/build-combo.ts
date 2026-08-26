import { getOddsPapiClient } from "@bet/oddspapi-client";
import { buildCombo as runComboSearch, extractCandidateLegs } from "@bet/combo-engine";
import { z } from "zod";

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
    const client = getOddsPapiClient();
    const tournamentLists = await Promise.all(input.sports.map((sportId) => client.listTournaments(sportId)));
    return tournamentLists
      .flat()
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

  const fixtures = await getOddsPapiClient().getOddsByTournaments({ tournamentIds });
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
