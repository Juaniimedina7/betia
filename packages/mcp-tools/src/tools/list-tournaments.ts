import { getOddsPapiClient } from "@bet/oddspapi-client";
import { z } from "zod";

export const listTournamentsInput = z.object({
  sportId: z.string(),
});

export type ListTournamentsInput = z.infer<typeof listTournamentsInput>;

export async function listTournaments(input: ListTournamentsInput) {
  const tournaments = await getOddsPapiClient().listTournaments(input.sportId);
  return { tournaments };
}
