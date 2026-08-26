import { Redis } from "@upstash/redis";
import type { BookmakerOdds } from "../types";
import type { OddsCache } from "./types";

let cachedRedis: Redis | undefined;

function getRedis(): Redis {
  if (!cachedRedis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set");
    }
    cachedRedis = new Redis({ url, token });
  }
  return cachedRedis;
}

const keyFor = (fixtureId: string) => `odds:fixture:${fixtureId}`;

export class RedisOddsCache implements OddsCache {
  async setFixtureOdds(fixtureId: string, odds: BookmakerOdds, ttlSeconds: number): Promise<void> {
    await getRedis().set(keyFor(fixtureId), JSON.stringify(odds), { ex: ttlSeconds });
  }

  async getFixtureOdds(fixtureId: string): Promise<BookmakerOdds | null> {
    const raw = await getRedis().get<string>(keyFor(fixtureId));
    if (!raw) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as BookmakerOdds) : (raw as BookmakerOdds);
  }
}
