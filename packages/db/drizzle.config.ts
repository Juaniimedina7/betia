import { defineConfig } from "drizzle-kit";

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
