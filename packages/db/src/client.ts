import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Lazy singleton — avoids reading DATABASE_URL at module import time. */
export function getDb() {
  if (!cachedDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    const sql = neon(url);
    cachedDb = drizzle(sql, { schema });
  }
  return cachedDb;
}

export type Db = ReturnType<typeof getDb>;
