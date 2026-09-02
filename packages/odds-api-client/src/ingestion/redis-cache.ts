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

// Key prefix kept as "odds:fixture:" (not "odds:event:") on purpose — no functional
// reason to rename it, and doing so would be pure churn for every SSE/Redis reader.
const keyFor = (eventId: string) => `odds:fixture:${eventId}`;

export class RedisOddsCache implements OddsCache {
  async setFixtureOdds(eventId: string, odds: BookmakerOdds, ttlSeconds: number): Promise<void> {
    await getRedis().set(keyFor(eventId), JSON.stringify(odds), { ex: ttlSeconds });
  }

  async getFixtureOdds(eventId: string): Promise<BookmakerOdds | null> {
    const raw = await getRedis().get<string>(keyFor(eventId));
    if (!raw) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as BookmakerOdds) : (raw as BookmakerOdds);
  }
}
