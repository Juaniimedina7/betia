import { getOddsPapiClient, RedisOddsCache } from "@bet/oddspapi-client";
import { z } from "zod";

export const getOddsInput = z.object({
  fixtureId: z.string(),
});

export type GetOddsInput = z.infer<typeof getOddsInput>;

const cache = new RedisOddsCache();

export async function getOdds(input: GetOddsInput) {
  try {
    const cached = await cache.getFixtureOdds(input.fixtureId);
    if (cached) {
      return { fixtureId: input.fixtureId, bookmakerOdds: cached, source: "redis" as const };
    }
  } catch {
    // Redis not configured (e.g. local dev without Upstash) — fall through to a live fetch.
  }

  const fixture = await getOddsPapiClient().getOdds(input.fixtureId);
  return { fixtureId: input.fixtureId, bookmakerOdds: fixture.bookmakerOdds ?? {}, source: "live" as const };
}
