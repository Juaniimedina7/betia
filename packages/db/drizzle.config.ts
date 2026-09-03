import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (!process.env.DATABASE_URL) {
  const possiblePaths = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../../.env.local"),
    resolve(process.cwd(), "../../apps/web/.env"),
    resolve(process.cwd(), "../../apps/web/.env.local"),
    resolve(process.cwd(), "apps/web/.env"),
    resolve(process.cwd(), "apps/web/.env.local"),
  ];

  for (const envPath of possiblePaths) {
    if (existsSync(envPath)) {
      try {
        process.loadEnvFile(envPath);
        if (process.env.DATABASE_URL) break;
      } catch {
        // ignore errors reading invalid/unformatted env files
      }
    }
  }
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    // Self-signed cert on the VPS Postgres — matches src/client.ts's Pool config.
    // Without this, drizzle-kit's own connection hangs on the TLS handshake instead
    // of failing fast (it doesn't honor `sslmode=no-verify` from the URL itself).
    ssl: { rejectUnauthorized: false },
  },
});
