# bet_project — infra notes

Monorepo (pnpm workspaces): `apps/web` (Next.js) + `packages/{db,combo-engine,mcp-tools,oddspapi-client}`.

## Database — self-hosted Postgres on VPS (migrated from Neon, 2026-08-30)

The app no longer uses Neon. Postgres runs in Docker on a VPS shared with other,
unrelated projects (`aprendeconfase`, `iolbot`) — don't touch their native Postgres
or nginx sites when working here.

- **Host:** `74.208.117.138` (root SSH access — password in the team's shared vault /
  ask a teammate; also referenced as `VPS_HOST`/`VPS_PASS` in the repo's root `.env.local`)
- **Container:** `bet-postgres`, defined in `/opt/bet-db/docker-compose.yml` on the VPS
  (`postgres:16`, named volume `bet_pg_data`, healthcheck on `pg_isready`)
- **Port:** `5433` (host) → `5432` (container). Port `5432` on the VPS is a *different*,
  pre-existing native Postgres 16 instance used by `aprendeconfase` — do not reuse it.
- **TLS:** self-signed cert at `/opt/bet-db/certs/{server.crt,server.key}` on the VPS.
  `pg_hba.conf` inside the container was edited to `hostssl` for the wildcard remote rule
  — non-TLS connections are rejected. Client code connects with `sslmode=no-verify`
  (encrypted, cert chain not verified — self-signed, so there's no CA to verify against).
- **DB / user:** database `bet_project`, user `bet_app` (own login, not `postgres` superuser).
- **Firewall:** VPS `ufw` is active with an explicit allowlist (`22, 80, 3110, 5000, 5001,
  5433` + whatever was already there, e.g. `7700`) — if you add a new exposed port on this
  VPS for *any* project, you must `ufw allow` it or it won't be reachable, and you must also
  check the **cloud provider's firewall/security group** (separate from `ufw`, blocks
  everything but a small default allowlist by provider default — this bit us once already).
- **Connection string shape:**
  `postgresql://bet_app:<password>@74.208.117.138:5433/bet_project?sslmode=no-verify`
  (password lives in `apps/web/.env.local` `DATABASE_URL` and in `/opt/bet-db/.env` on the VPS —
  not written here on purpose).

### Code changes from the Neon migration
- `packages/db/src/client.ts`: swapped `@neondatabase/serverless` + `drizzle-orm/neon-http`
  for `pg` (`Pool`) + `drizzle-orm/node-postgres`. `ssl: { rejectUnauthorized: false }` is set
  explicitly to match the self-signed cert.
- `packages/db/package.json`: dependency swap (`pg` + `@types/pg` in, `@neondatabase/serverless` out).
- `drizzle.config.ts` unchanged — `dialect: "postgresql"` works against any Postgres, not Neon-specific.
- Schema was pushed fresh (`drizzle-kit push`) to the new empty DB — **no data was migrated**
  from the old Neon database (there wasn't meaningful prod data yet at migration time).
- Leftover unused Neon env vars in `apps/web/.env.local` (`PGHOST`, `POSTGRES_URL*`,
  `NEON_AUTH_BASE_URL`, `NEON_PROJECT_ID`, `VITE_NEON_AUTH_URL`, etc.) were intentionally
  left in place — nothing in the code reads them, and Neon Auth (if ever wired up) is a
  separate concern from the Postgres migration. Safe to clean up later if confirmed unused.

## Next steps / open items

1. **Vercel `DATABASE_URL` not yet updated.** The Vercel project this repo was linked to
   (`web`, org `agustinvenutolo-3540s-projects`, project id `prj_rGNcMzwG71553eCEM781Y4zHn9JC`)
   no longer shows up for the currently logged-in CLI account (`vercel env ls` /
   `vercel project ls` — project not listed, "deleted, transferred, or no access"). Someone
   with access to wherever the project actually lives now needs to either re-share access or
   confirm the correct team, then run `vercel env add DATABASE_URL` (production + preview)
   with the connection string above. Until this is done, **deployed environments are still
   pointed at the old Neon database** — only local dev (`apps/web/.env.local`) uses the VPS DB.
2. No automated backups configured yet for `bet-postgres` (Neon had this for free). Consider
   a cron `pg_dump` to somewhere off-VPS before this DB holds real user data.
3. TLS is encryption-only (self-signed, `sslmode=no-verify`), not certificate-verified. Fine
   for now; if this ever needs to be hardened, look at a real cert (e.g. Let's Encrypt via a
   sidecar) or pinning the self-signed cert's public key on the client side instead of
   disabling verification.
4. Connection pooling: `pg.Pool` in `client.ts` is a per-process pool, not shared across
   serverless invocations the way Neon's HTTP driver was. Watch Postgres `max_connections`
   under load from Vercel Functions; consider PgBouncer on the VPS if this becomes a problem.
