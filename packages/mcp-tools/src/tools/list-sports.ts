import { getOddsPapiClient } from "@bet/oddspapi-client";
import { z } from "zod";

export const listSportsInput = z.object({
  activeOnly: z.boolean().optional(),
});

export type ListSportsInput = z.infer<typeof listSportsInput>;

export async function listSports(_input: ListSportsInput) {
  const sports = await getOddsPapiClient().listSports();
  return { sports };
}
