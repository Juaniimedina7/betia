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

## Odds provider: The Odds API, migrated from OddsPapi (2026-09-02)

**Switched from OddsPapi (`oddspapi.io`) to The Odds API (`the-odds-api.com`)** — a
different provider with a different data model, not just a different key. One string
`sport_key` (e.g. `soccer_epl`) replaces OddsPapi's two-level numeric `sportId` +
`tournamentId`; `GET /v4/sports/{sport}/odds` returns fixtures **and** every requested
bookmaker's odds together in one call (no more 5-tournament batching or
one-bookmaker-per-call); there's no stable participant id, only `home_team`/`away_team`
name strings; markets are flat (`{key, outcomes: [{name, price, point?}]}`, no player
dimension). New client: `packages/odds-api-client` (`@bet/odds-api-client`).

**Also changed as part of this migration: strict API → DB → cache → web.** Before this,
several MCP tools (`build_combo`'s cold-cache fallback, `list_fixtures`/`list_sports`/
`list_tournaments`'s live-first pattern, `get_odds`'s live middle tier,
`get_odds_by_tournament`/`get_best_price`'s always-live calls) and the public landing
page's `GET /api/odds` all called the odds API live on a per-request basis — the real
quota risk, not just the cron. Now **only `/api/ingest/poll` may call the odds API
live**; every tool, page, and the agent chat reads `odds_cache`/`sports_cache`
(Postgres) or Redis only. `get_historical_odds`/`get_scores`/`get_settlements` were
dropped entirely (OddsPapi-era tools with no cache-backed equivalent) rather than
rebuilt with dedicated history tables — out of scope for the migration.

### Quota — confirmed live 2026-09-02, do not assume OddsPapi's model carries over

The Odds API bills **500 requests/month** on the current plan (confirmed via
`x-requests-remaining`/`x-requests-used` response headers), and — this is the part that
doesn't carry over from OddsPapi — **cost = 1 credit per *market* requested per call**,
regardless of how many bookmakers you ask for via the `bookmakers` param (confirmed
live: requesting 2 bookmakers with `markets=h2h` cost 1 credit; `markets=h2h,totals`
cost 2). OddsPapi billed per HTTP call with a 5-tournament batch cap; that formula does
not apply here.

`.github/workflows/poll-odds.yml` runs `/api/ingest/poll` **once a day at 17:00
Argentina time / 20:00 UTC** (`0 20 * * *` — changed from `0 9 * * *` on 2026-09-03 to
land the refresh closer to when the primary audience actually uses the platform)
requesting **1 market** (`h2h`) across **15 fixed `sport_key`s** (13 soccer leagues +
`basketball_nba` + `americanfootball_nfl`, see `apps/web/lib/ingest/watched-sport-keys.ts`)
**plus up to 2 dynamically-discovered active tennis tournaments** (see the "Multi-sport"
subsection below) and **7 bookmakers** (`DEFAULT_BOOKMAKERS = ["pinnacle", "unibet",
"betano_uk", "codere_it", "betsson", "betway", "espnbet"]` in
`apps/web/app/api/ingest/poll/route.ts`, overridable via `ODDSAPI_BOOKMAKERS`) — one
`GET /v4/sports/{sport}/odds` call per watched sport_key, so 15–17 requests/run × ~30
runs/month ≈ 450–510/month, close to the 500 cap but with margin most months (the
17-request peak only happens when 2 tennis tournaments are simultaneously active,
which isn't year-round). **The bookmaker count doesn't affect this math at all** —
cost is per market requested, not per bookmaker (see above), so 7 bookmakers cost
exactly the same as 2 did. The route also refreshes `sports_cache` every run
(`listSports()`, free — no market param, doesn't count toward the per-market cost
above) since no tool has a live-fallback write path anymore to keep it warm otherwise.

**Bet365 is not available on The Odds API** (confirmed live across a full survey of
all 66 bookmakers this account can see across the then-16 watched soccer leagues,
2026-09-02 — it never appeared once, unlike OddsPapi). Pinnacle stays as the de-vig
reference (sharp book, low vig); the other 6 (`unibet`, `betano_uk`, `codere_it`,
`betsson`, `betway`, `espnbet`) were picked by hand from that survey. **Coverage isn't
uniform across leagues/sports** — a book present in the survey can still be missing
from a specific league or sport (several Europe-focused books, e.g. `williamhill`,
drop out entirely for South American leagues; `unibet` was specifically checked live
for full South American coverage — Argentina/Brazil/Mexico/Libertadores/Sudamericana —
the other 5 weren't individually re-verified per league or for NBA/NFL/tennis).
`build_combo`'s `bookmaker` filter (see below) can legitimately come back empty for a
book+sport_key combination even though the book is in `DEFAULT_BOOKMAKERS`.

**The soccer watchlist shrank from OddsPapi's 20 tournaments to 13 `sport_key`s** (was
16 as of the 2026-09-02 provider migration, cut further to 13 on 2026-09-03 to make
room for NBA/NFL/tennis) — three separate reasons, don't conflate them:
- **Uruguay's Primera División and Colombia's Primera A don't exist on The Odds API at
  all** (checked live, including `GET /v4/sports?all=true` for out-of-season
  competitions) — a real, permanent coverage gap, not a bug.
- **Belgium's Pro League and the Dutch Eredivisie were cut for quota** on 2026-09-02 —
  18 confirmed-available leagues × 1 market × 30 runs/month would have been 540/month,
  over the 500 budget.
- **Portugal's Primeira Liga and Chile's Primera División were cut for quota** on
  2026-09-03, specifically to make room for adding NBA, NFL, and tennis — chosen as
  the two lowest-event-count domestic leagues remaining once the continental cups
  (deliberately protected both times) were taken off the table.

### Multi-sport: NBA, NFL, and tennis added (2026-09-03)

Added `basketball_nba` and `americanfootball_nfl` to the fixed watchlist — both are
single, stable, year-round `sport_key`s exactly like a soccer league, so no special
handling needed beyond adding them to `DEFAULT_WATCHED_SPORT_KEYS`. Verified live that
NBA/NFL/tennis events return the same shape as soccer (`home_team`/`away_team`, `h2h`
market with 2 (not 3) outcomes since none of these have a draw) — every existing
consumer (`extractCandidateLegs`, `list-fixtures`, `featured-events.ts`'s
`headlineMarket`, `MatchesList.tsx`, `live-odds-table.tsx`) already handled 2-way
markets generically, so **no changes were needed to any of that code** — only to the
watchlist, `sports_cache` schema/population, and the Spanish sport-name display logic
(`packages/mcp-tools/src/tools/list-sports.ts`'s `SPANISH_GROUP_NAMES`,
`apps/web/lib/featured-events.ts`'s `sportNameForKey`).

**Tennis needed different treatment, not just a 3rd hardcoded sport_key.** The Odds
API has no continuous "ATP/WTA tour" the way soccer has stable leagues — each
tournament (Wimbledon, US Open, a Masters event, etc.) is its own `sport_key` that
only exists `active: true` during that ~1-2 week window each year (confirmed live
2026-09-03: of 44 known tennis `sport_key`s, only `tennis_atp_us_open` and
`tennis_wta_us_open` were active on that date; every major and most Masters events
were `active: false`). Hardcoding one would mean paying for it 50 weeks a year with
zero events returned. Instead: `sports_cache` gained an `active` boolean column
(populated from `Sport.active` on every `listSports()` refresh, which the ingest route
already calls every run), and `apps/web/lib/ingest/watched-sport-keys.ts`'s
`watchedSportKeys()` queries it live each run for `group = "Tennis" AND active = true`,
capped at `MAX_TENNIS_TOURNAMENTS_PER_RUN = 2` (a defensive bound, not a precise
calculation — concurrent-tournament count varies through the year; redo this cap if
it turns out to spike the monthly total past 500 in practice). An explicit
`WATCHED_SPORT_KEYS` env override skips this dynamic discovery entirely (an override
means exactly that list, not that list plus auto-discovered tennis).

**The statistical-probability model (Poisson/`estimate_match_probability`) stays
soccer-only.** `packages/mcp-tools/src/league-map.ts`'s `LEAGUE_MAP` and the
Highlightly stats pipeline (`apps/web/app/api/ingest/poll-stats/route.ts`,
`team_season_stats`) were never touched — NBA/NFL/tennis fixtures simply get
`available: false` / `resolved: false` from `estimate_match_probability`/
`get_team_stats`/`get_head_to_head` (same `tournament_not_mapped` path an unmapped
soccer sport_key already hits). Extending Highlightly (or a different stats provider)
to cover basketball/NFL/tennis is a separate, larger task — out of scope here.

`packages/odds-api-client/src/ingestion/rest-polling-source.ts` polls with a flat
`for (sportKey of watchedSportKeys) { client.getSportOdds(sportKey, {bookmakers, markets}) }`
loop — no per-bookmaker looping or batching needed, since one call already returns
every requested bookmaker's odds together. The DB upsert
(`apps/web/app/api/ingest/poll/route.ts`) is now a **plain overwrite** of
`odds_cache.bookmaker_odds`, not the jsonb `||` merge OddsPapi's ingest needed — that
merge existed specifically because OddsPapi's ingest made one API call *per bookmaker*
(separate write events for the same fixture); The Odds API bundles every requested
bookmaker into one event, so there's nothing left to merge.

If you need to add sports beyond soccer, or change cadence/league count/bookmaker
count/markets requested, redo this budget math first:
`requests/month = runs/month × sport_keys × markets.length`, and keep it under ~500
(leave headroom for manual `workflow_dispatch` runs).

### build_combo is cache-only, no live fallback (2026-09-02)

`packages/mcp-tools/src/tools/build-combo.ts` briefly had a narrow live-fallback (added
2026-09-01, for the case where the requested tournaments had zero cached rows) — that
fallback was **removed** in the OddsPapi→The Odds API migration, since the whole point
of the new API → DB → cache → web architecture is that no user-facing tool calls the
odds API live, full stop. A cold/off-watchlist `sport_key` now just returns the existing
empty-result shape ("no se encontraron partidos") instead of triggering a live call.
Every other odds-touching MCP tool (`list_fixtures`, `list_sports`, `list_tournaments`,
`get_odds`, `get_odds_by_tournament`, `get_best_price`) went through the same
live-fallback-removal during this migration — none of them import the odds API client
anymore; only `/api/ingest/poll` does.

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
current-season restriction. This is what makes covering all watched leagues
affordable: `apps/web/app/api/ingest/poll-stats/route.ts` refreshes **every mapped
league's full standings every run** (flat request count = league count, no staleness
tracking needed for team stats at all — always ≤24h stale given the cron's current
cadence, see below). Head-to-head (`GET /head-2-head?teamIdOne&teamIdTwo`) is still
pairwise, so that side keeps a staleness window (14 days — head-to-head history only
changes when the same two teams play again) and a per-run cap
(`MAX_H2H_FETCHES_PER_RUN=15`). Budget (post OddsPapi→The Odds API migration,
2026-09-02): `1 run/day × (16 standings + 15 h2h) = 31 requests/day`, well under the
100/day cap — the watched-league count dropped from 20 to 16 as part of that migration
(see the odds-provider section above for why), which only grew this route's already
comfortable headroom. Redo this math (`requests/day = runs/day × per-run cost`) before
changing cadence, league coverage, or the H2H cap.

`.github/workflows/poll-odds.yml` runs `/api/ingest/poll-stats` as a second,
independent step in the same once-a-day job as the odds poll (`0 9 * * *`) — a
stats-ingestion failure must never mask a successful odds poll, or vice versa.

The Odds API `sport_key` → Highlightly `{leagueId, season}` is hand-curated in
`packages/mcp-tools/src/league-map.ts` (`LEAGUE_MAP`) — same pattern as
`DEFAULT_WATCHED_SPORT_KEYS` above. **Originally filled in and verified 2026-08-31**
against live `GET /leagues?limit&offset` calls (back when it was keyed by OddsPapi
tournamentId); **rekeyed (not re-verified) 2026-09-02** when the odds provider
migration replaced those numeric ids with `sport_key` strings — the Highlightly-side
`{leagueId, season}` values are untouched, only the left-hand keys changed. Uruguay and
Colombia's old entries were dropped along with their watchlist entries (see above — The
Odds API doesn't cover those leagues at all, not a Highlightly issue). Two exceptions
remain, both noted inline in the file: Copa America is biennial (mapped to its last
completed season `2024`, no 2025/2026 edition yet — don't bump this one's year alongside
the annual leagues); the old Uruguay split-Apertura/Clausura note no longer applies
since Uruguay isn't watched at all anymore. If a `sport_key` has no entry here,
`/api/ingest/poll-stats` skips it and the three MCP tools
(`get_team_stats`/`get_head_to_head`/`estimate_match_probability`) return
`resolved:false`/`available:false` for it. Re-check every entry at each season
boundary — a stale `season` value silently returns empty/wrong stats rather than
erroring.

Team-name matching (odds-provider team name → Highlightly team id) is exact-then-fuzzy
(Levenshtein), scoped to one league+season roster at a time (the `/standings` response
for that league doubles as the candidate roster — no separate "list teams" call
needed) — see `apps/web/lib/ingest/team-name-matching.ts`. Resolutions are cached in
the `team_id_map` table (deliberately provider-agnostic naming, given this project
already switched odds providers once) with a `matchStrategy`/`matchConfidence` pair so
a low-confidence fuzzy match can be audited/corrected by hand later. The table's
primary key was rekeyed from `oddspapi_participant_id` to `team_key` during the
2026-09-02 migration — The Odds API has no stable participant id at all, only
`home_team`/`away_team` name strings, so `team_key` is
`` `${sportKey}:${slug(teamName)}` `` (see `packages/mcp-tools/src/team-resolution.ts`)
rather than a provider-issued id.

Home/away: **resolved as of the 2026-09-02 odds-provider migration.** OddsPapi never
confirmed whether `participant1`/`participant2` always ordered as home/away, so
`estimate_match_probability` carried an optional override param for it. The Odds API's
events are explicit (`home_team`/`away_team` fields), so that whole class of ambiguity
is gone — `estimate_match_probability`/`get_head_to_head` now just take `homeTeam`/
`awayTeam` directly, no override param needed. Separately, Highlightly's
`/head-2-head` response still doesn't label which side of its `"3 - 0"` score string is
home vs away — `packages/highlightly-client` assumes home-first (matching its separate
`homeTeam`/`awayTeam` fields), still unverified against a known real result; this is an
unrelated, still-open item.

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
7. **`ODDSAPI_API_KEY` is set locally (`apps/web/.env.local`, was already provisioned
   before the 2026-09-02 OddsPapi→The Odds API migration started) but not yet in
   production**, same gap as items 2 and 6 — needs adding to the real prod Vercel
   project (see item 1). The old `ODDSPAPI_API_KEY`/`ODDSPAPI_HOST`/
   `ODDSPAPI_TIMEOUT_MS`/`WATCHED_TOURNAMENT_IDS` env vars are safe to remove from
   Vercel and `.env.local` whenever convenient — nothing in the code reads them
   anymore (same "safe to clean up later" situation as the leftover Neon vars above).
