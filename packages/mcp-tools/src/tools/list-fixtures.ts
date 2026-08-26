import { getOddsPapiClient } from "@bet/oddspapi-client";
import { z } from "zod";

export const listFixturesInput = z.object({
  sportId: z.string().optional(),
  tournamentId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  statusId: z.string().optional(),
});

export type ListFixturesInput = z.infer<typeof listFixturesInput>;

export async function listFixtures(input: ListFixturesInput) {
  const fixtures = await getOddsPapiClient().listFixtures(input);
  return { fixtures };
}
