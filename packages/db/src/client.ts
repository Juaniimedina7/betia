import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Lazy singleton — avoids reading DATABASE_URL at module import time. */
export function getDb() {
  if (!cachedDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    // Self-signed cert on the VPS Postgres — encrypts in transit, doesn't chain-verify.
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
    cachedDb = drizzle(pool, { schema });
  }
  return cachedDb;
}

export type Db = ReturnType<typeof getDb>;
