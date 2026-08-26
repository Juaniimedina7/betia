import { getOddsPapiClient } from "@bet/oddspapi-client";
import { z } from "zod";

export const getOddsByTournamentInput = z.object({
  tournamentIds: z.array(z.string()).min(1),
  bookmaker: z.string().optional(),
  oddsFormat: z.enum(["decimal", "american", "fractional"]).optional(),
});

export type GetOddsByTournamentInput = z.infer<typeof getOddsByTournamentInput>;

export async function getOddsByTournament(input: GetOddsByTournamentInput) {
  // OddsPapi requires exactly one bookmaker; default to a broad-coverage reference book
  // so this tool doesn't 400 when the caller omits it.
  const bookmaker = input.bookmaker ?? "pinnacle";
  const fixtures = await getOddsPapiClient().getOddsByTournaments({ ...input, bookmaker });
  return { fixtures };
}
