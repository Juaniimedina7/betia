import { getOddsPapiClient } from "@bet/oddspapi-client";
import { z } from "zod";

export const getOddsByTournamentInput = z.object({
  tournamentIds: z.array(z.string()).min(1),
  bookmaker: z.string().optional(),
  oddsFormat: z.enum(["decimal", "american", "fractional"]).optional(),
});

export type GetOddsByTournamentInput = z.infer<typeof getOddsByTournamentInput>;

export async function getOddsByTournament(input: GetOddsByTournamentInput) {
  const fixtures = await getOddsPapiClient().getOddsByTournaments(input);
  return { fixtures };
}
