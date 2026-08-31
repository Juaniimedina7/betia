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

## OddsPapi quota (2026-08-30)

OddsPapi bills **250 requests/month total** (not an hourly/daily window — confirmed
via `oddspapi.io/es/docs/requests-and-quota`). The 429 seen this session
("Request limit exceeded... limit of 250 requests") was the whole month's budget,
not a burst limit — plan the ingest cron's cost around a monthly total, not a rate.

`.github/workflows/poll-odds.yml` runs `/api/ingest/poll` twice a day (`0 9,21 * * *`),
~4 requests/run (20 hardcoded soccer `tournamentIds` in
`apps/web/app/api/ingest/poll/route.ts`, batched 5 per `/v4/odds-by-tournaments` call)
→ ~240 requests/month, leaving a little headroom for manual `workflow_dispatch` runs.
The route no longer calls `listSports()` on every run (dropped — it's static reference
data already refreshed by live UI traffic; wasn't worth ~60 requests/month).

If you need to add sports beyond soccer (basketball/tennis/boxing were requested but
blocked this session by the exhausted quota — couldn't verify their `sportId`s live)
or change cadence/tournament count, redo this budget math first:
`requests/month = runs/month × ceil(tournamentIds / 5)`, and keep it under ~250.

## Highlightly quota (2026-08-31)

Second external data source, added for statistical (Poisson-model) win/draw/loss
probability — separate from OddsPapi's market-implied odds, and never to be confused
with it (see `apps/web/lib/agent/parlay-agent.ts`'s "probabilidad de mercado" vs
"probabilidad estadística" rule).

**This replaced API-Football, tried first and abandoned same-day.** API-Football's
free tier (`api-football.com`) turned out to have no live-testable-in-advance
restriction blocking the *current* season on every season-scoped endpoint
(`/teams`, `/teams/statistics`, `/fixtures?season=`) — only pre-2025 seasons, plus a
narrow ~3-day rolling window on date-based fixture queries. Its `/fixtures/headtohead`
endpoint (unrestricted, no season param) still works fine and forever, but the
season-scoped stats needed for the Poisson model don't, on the free tier. That
discovery — and the coverage gap of the next candidate tried, football-data.org's free
tier (only 12 competitions, missing most of this project's South American coverage) —
is why this project is on Highlightly instead. **Lesson for next time: verify any new
provider's real (not just documented) season/coverage restrictions with a live key
before designing ingestion around it** — none of the above was discoverable from
public docs alone.

Highlightly (`highlightly.net`, also listed on RapidAPI) bills **100 requests/day** on
the free BASIC plan, and — confirmed live with 10 rapid-fire calls — **no per-minute
throttle**, unlike API-Football. Auth is a header: `x-rapidapi-key: <HIGHLIGHTLY_API_KEY>`
(no host header needed when calling `soccer.highlightly.net` directly, i.e. not
through RapidAPI's own gateway). Free-tier signup is via `highlightly.net` → Dashboard
→ Sign Up (Auth0-based, email/password or Google/GitHub), no credit card required. The
daily count is also readable off every response's `x-ratelimit-requests-remaining`
header.

The big win over API-Football: `GET /standings?leagueId&season` returns **every
team's** current-season home/away/total wins/draws/losses/goals-for/goals-against for
an entire league in **one call** — no per-team stats endpoint needed, and no
current-season restriction. This is what makes covering all 20 watched tournaments
affordable: `apps/web/app/api/ingest/poll-stats/route.ts` refreshes **all 20 leagues'
full standings every run** (flat 20 requests, no staleness tracking needed for team
stats at all — always ≤12h stale given the 2x/day cron). Head-to-head
(`GET /head-2-head?teamIdOne&teamIdTwo`) is still pairwise, so that side keeps a
staleness window (14 days — head-to-head history only changes when the same two teams
play again) and a per-run cap (`MAX_H2H_FETCHES_PER_RUN=15`). Budget:
`2 runs/day × (20 standings + 15 h2h) = 70 requests/day`, leaving ~30/day headroom for
manual reruns. Redo this math (`requests/day = runs/day × per-run cost`) before
changing cadence, tournament coverage, or the H2H cap.

`.github/workflows/poll-odds.yml` runs `/api/ingest/poll-stats` as a second,
independent step in the same twice-daily job as the odds poll (`0 9,21 * * *`) — a
stats-ingestion failure must never mask a successful odds poll, or vice versa.

OddsPapi `tournamentId` → Highlightly `{leagueId, season}` is hand-curated in
`packages/mcp-tools/src/league-map.ts` (`LEAGUE_MAP`) — same pattern as
`DEFAULT_WATCHED_TOURNAMENT_IDS` above. **Filled in and verified 2026-08-31** against
live `GET /leagues?limit&offset` calls, all 20 watched tournaments mapped with a full
2026 season available. Two exceptions, both noted inline in the file: Copa America is
biennial (mapped to its last completed season `2024`, no 2025/2026 edition yet — don't
bump this one's year alongside the annual leagues) and Uruguay's top flight runs as
split Apertura/Clausura tournaments rather than one continuous league (mapped to
Apertura). If a tournament has no entry here, `/api/ingest/poll-stats` skips it and the
three MCP tools (`get_team_stats`/`get_head_to_head`/`estimate_match_probability`)
return `resolved:false`/`available:false` for it. Re-check every entry at each season
boundary — a stale `season` value silently returns empty/wrong stats rather than
erroring.

Team-name matching (OddsPapi participant name → Highlightly team id) is exact-then-
fuzzy (Levenshtein), scoped to one league+season roster at a time (the `/standings`
response for that league doubles as the candidate roster — no separate "list teams"
call needed) — see `apps/web/lib/ingest/team-name-matching.ts`. Resolutions are cached
in the `team_id_map` table (deliberately provider-agnostic naming, given this project
already switched providers once) with a `matchStrategy`/`matchConfidence` pair so a
low-confidence fuzzy match can be audited/corrected by hand later.

Home/away assumption: `estimate_match_probability` takes an optional
`homeParticipantId` (defaults to `participant1Id`) rather than hard-assuming OddsPapi
always orders `participant1`/`participant2` as home/away — that ordering was never
confirmed against a live OddsPapi response (OddsPapi's own monthly quota was already
exhausted while this was built). Verify it the next time OddsPapi quota allows a live
check, and drop the optional param if it turns out to always be true. Separately,
Highlightly's `/head-2-head` response doesn't label which side of its `"3 - 0"` score
string is home vs away — `packages/highlightly-client` assumes home-first (matching
its separate `homeTeam`/`awayTeam` fields), unverified against a known real result.

## Next steps / open items

1. **The Vercel project actually serving production is NOT the one linked locally.**
   Production (`https://betia-web-brown.vercel.app`) deploys via
   `.github/workflows/deploy.yml` on every push to `main`, using project id
   `prj_9S2peNPSAokYC3YpeOdX6MVCzEXJ` / org `team_klaQ4k4O3uyzx9gNCCsGWN91` and a
   `VERCEL_TOKEN` GitHub secret belonging to a teammate ("Juani" per the workflow's own
   comment). The local `.vercel/project.json` points at a *different*, stale/orphaned
   project (`prj_rGNcMzwG71553eCEM781Y4zHn9JC`, org `agustinvenutolo-3540s-projects`)
   that no longer even shows up for the currently logged-in local CLI account. **Before
   assuming a prod env var is missing or stale, check `deploy.yml` for the real
   `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`, not the local link.** Confirming/updating real
   prod env vars (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `HIGHLIGHTLY_API_KEY`, etc.)
   requires whoever holds the `VERCEL_TOKEN` secret to run `vercel env add` against
   that project, or to grant CLI access to `team_klaQ4k4O3uyzx9gNCCsGWN91`.
2. **`ANTHROPIC_API_KEY` is not yet set anywhere real.** The parlay agent
   (`apps/web/lib/agent/parlay-agent.ts`) calls Anthropic directly via
   `@ai-sdk/anthropic`. Local `.env.local` has a placeholder (`"REPLACE_ME"`) and prod
   (see item 1) has never had this key added — until both are set with a real key, the
   agent chat fails with a 401 from Anthropic that the UI doesn't surface as a visible
   error message (only a generic "algo falló" banner), so it can look like the agent
   is silently doing nothing.
3. No automated backups configured yet for `bet-postgres` (Neon had this for free). Consider
   a cron `pg_dump` to somewhere off-VPS before this DB holds real user data.
4. TLS is encryption-only (self-signed, `sslmode=no-verify`), not certificate-verified. Fine
   for now; if this ever needs to be hardened, look at a real cert (e.g. Let's Encrypt via a
   sidecar) or pinning the self-signed cert's public key on the client side instead of
   disabling verification.
5. Connection pooling: `pg.Pool` in `client.ts` is a per-process pool, not shared across
   serverless invocations the way Neon's HTTP driver was. Watch Postgres `max_connections`
   under load from Vercel Functions; consider PgBouncer on the VPS if this becomes a problem.
6. **`HIGHLIGHTLY_API_KEY` is set locally (`apps/web/.env.local`) but not yet in
   production.** `LEAGUE_MAP` is filled in (see "Highlightly quota" above), so
   `/api/ingest/poll-stats` is ready to actually ingest — it just needs the key added
   to the real prod Vercel project (see item 1) the same way `ANTHROPIC_API_KEY` does.
