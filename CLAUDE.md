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

### Hourly cleanup of expired odds_cache rows (2026-09-03)

`GET /api/ingest/cleanup` deletes `odds_cache` rows whose `commence_time` is already in
the past, plus the matching Redis key (`RedisOddsCache.deleteFixtureOdds`, best-effort —
those keys already carry a 120s TTL from ingest, so a Redis miss/error here is harmless).
It doesn't call the odds API at all, so it doesn't touch the monthly quota math above.
Runs hourly via `.github/workflows/cleanup-odds.yml` (`0 * * * *`, same GitHub-Actions-cron
pattern as `poll-odds.yml` — Vercel Hobby only allows daily crons), same `CRON_SECRET`
bearer-auth as the other `/api/ingest/*` routes.

### Auto-settlement: grading bet_slip_legs against real results (2026-09-04)

`GET /api/ingest/settle` marks each pending `bet_slip_legs` row won/lost/void once its
match has finished, then settles the parent `bet_slips.status` (won/lost/push) once
every leg is resolved — automating what `update_bet_slip_outcome` only did as a manual,
self-reported action before. It never overwrites `userMarkedOutcome` (that field stays
reserved for an actual human self-report) and only looks at slips whose `status` is
still `saved`/`placed_by_user`, so a manually-marked slip is never touched.

**New: `OddsApiClient.getScores(sportKey, { eventIds?, daysFrom? })`**
(`packages/odds-api-client`), wrapping `GET /v4/sports/{sport}/scores` — a real
endpoint this client never called before (`get_scores`/`get_settlements` were dropped
without a replacement in the 2026-09-02 OddsPapi→The Odds API migration, see above).
**Confirmed live 2026-09-04: this endpoint costs a flat 2 credits per call**, regardless
of `eventIds` or `daysFrom` — a different, more expensive cost model than `/odds`'s
"1 credit per market requested" (see the Quota section above). This matters because the
odds-poll cron already runs the monthly budget close to its 500-request cap — polling
scores for all 15-17 watched `sport_key`s on every run the way `poll/route.ts` does
would blow it immediately (17 sports × 2 credits × 24 runs/day would be enormous).

Instead, `/api/ingest/settle` only calls `getScores` for `sport_key`s that actually have
a `bet_slip_legs` row still `"pending"`, `marketId="h2h"`, and `startTime` more than 3h
in the past (`SETTLE_DELAY_MS`) — most runs find nothing pending and cost 0 credits. A
leg older than 3 days (`MAX_AGE_MS`, matching the scores endpoint's own `daysFrom` cap
of 3) is left `"pending"` forever with no alert — a known, accepted gap, not something
worth building retry/alerting infra for at this stage. A defensive
`MAX_SPORTS_PER_RUN = 10` bounds a pathological run the same way `poll-stats/route.ts`'s
`MAX_H2H_FETCHES_PER_RUN` does, though it should essentially never bind in practice.

**Grading is h2h-only for now** (`apps/web/lib/settlement/grade-h2h-leg.ts`) — `save_bet_slip`
only ever writes `marketId="h2h"` legs today (`poll/route.ts` only ever polls
`markets: ["h2h"]`), so spreads/totals grading was never built; a leg with any other
`marketId` is left `pending` rather than guessed at. Grading matches `scores[].name`
against the leg's `participant1Id`/`participant2Id` (same provider-sourced team-name
strings captured at save time) rather than re-deriving home/away, and defensively voids
anything it can't grade with confidence (postponed/cancelled events with no `scores`,
name mismatches, a tie against a 2-outcome market with no "Draw" option). Slip-level
status (`apps/web/lib/settlement/derive-slip-status.ts`) follows the standard parlay
rule: any lost leg loses the slip; an all-void slip pushes; otherwise it's won.

Runs hourly via `.github/workflows/settle-bets.yml`, same GH-Actions-cron/`CRON_SECRET`
pattern as the other `/api/ingest/*` routes — safe at that cadence specifically because
idle runs are free; the real cost scales with how many distinct sports have unsettled
bets at once, not with how often the cron fires.

**This h2h-only limitation matters more after 2026-09-07** (see "Complementary odds
provider: API-Football" below) — non-h2h markets (hándicap, más/menos, ambos anotan,
etc.) are now visible to the agent/UI for the first time, so a user can actually save a
non-h2h leg today. That leg will sit `pending` forever under the same rule described
above — a known, deliberately accepted gap (not fixed as part of that odds work), not a
bug if you see one stuck.

## Complementary odds provider: API-Football (2026-09-07)

Added `packages/api-football-client` (`@bet/api-football-client`) as a **second, purely
additive** odds source — The Odds API stays the primary/only source for NBA, NFL,
tennis, and remains untouched for soccer too; this only *adds* bookmakers/markets on
top of it for the 13 watched soccer `sport_key`s. Motivation: **Bet365 is not available
on The Odds API at all** (confirmed live 2026-09-02, see above), and The Odds API only
ever polls the `h2h` market (see `MARKETS` in `poll/route.ts`) — adding more markets
there costs 1 extra credit per market per call against a monthly quota already close to
its cap. API-Football turned out to have a completely different, much cheaper cost
model for odds specifically (see below), making it a good complementary fit.

**Same provider, already burned once for a different reason.** API-Football
(`api-football.com`) was tried and dropped on 2026-08-31 as a **stats** source (see
"Highlightly quota" below) — its Free plan blocks the current season on every
season-scoped endpoint (`/teams`, `/teams/statistics`, `/fixtures?season=`).
**Re-confirmed live 2026-09-07: that restriction is still there.** But the odds
endpoints, used the way this integration uses them (see below), never hit it — this is
a different, viable use of the same account/key, not a retry of the abandoned one.

### Confirmed live 2026-09-07 (Free plan, `v3.football.api-sports.io`, `x-apisports-key` header)

- **100 requests/day, 10 requests/minute** (`x-ratelimit-requests-remaining` /
  `x-ratelimit-remaining` response headers).
- `GET /fixtures?league=39&season=2025` and `GET /odds?league=39&season=2025&date=...`
  both return `"Free plans do not have access to this season, try from 2022 to 2024"` —
  any call combining `league` + `season` for 2025/2026 is blocked, exactly like the
  stats endpoints were in August.
- **But odds calls that don't combine `league`+`season` work fine for the current
  season**: `GET /fixtures?date=<date>` (no `league`) and `GET /odds?fixture=<id>`
  (single fixture, no `season`) both returned real 2026-season data.
- **The bulk `GET /odds?date=<date>` endpoint (no `league`/`season`) looked like it also
  worked, but has a serious hidden gap — confirmed live 2026-09-08: it silently
  excludes major competitions.** A first design used this endpoint (paginated, ~16
  pages/day worldwide) to discover which fixtures have odds, then filtered client-side
  to our watched leagues. That missed UEFA Champions League, Copa Libertadores, and
  Copa Sudamericana fixtures entirely — 9 real fixtures across those 3 competitions for
  2026-09-09, each with confirmed real odds (5-13 bookmakers) via a direct
  `GET /odds?fixture=<id>` call for that exact fixture id, **zero of which appeared
  anywhere in the bulk endpoint's paginated listing for that date**. Whatever governs
  the bulk endpoint's inclusion list on the Free plan, it isn't "does this fixture have
  odds" — direct per-fixture lookup and the bulk listing are not the same dataset. This
  would have meant the integration silently never surfaced any of 3 of our 13 watched
  competitions, indefinitely, with no error anywhere. **Fixed same-day** by dropping the
  bulk endpoint entirely — see Design below.
- **Cost model is per fixture, not per market or bookmaker** — the opposite of The Odds
  API. One `GET /odds?fixture=<id>` call returns **every** bookmaker and **every** bet
  type for that one fixture (13 bookmakers, up to 97 bet types for one bookmaker, in a
  live sample). `GET /fixtures?date=<date>` (used only for discovery, not odds) returns
  every fixture worldwide for that date (250-350 in samples taken) in one call
  regardless of how many are ultimately relevant.
- **Catalog**: `GET /odds/bookmakers` lists 33 supported bookmakers (includes Bet365,
  William Hill, Betfair, 1xBet, Marathonbet, Pinnacle, Unibet, Betano, ...).
  `GET /odds/bets` lists 338 distinct bet types (Match Winner, Asian Handicap, Goals
  Over/Under, Both Teams Score, Double Chance, Correct Score, Odd/Even, and many
  first-half/second-half/per-team variants). Actual coverage per fixture is much
  smaller than 338 and varies — a live sample fixture (Liga Profesional Argentina)
  had 13 bookmakers actually quoted, none of `betway`/`codere_it`/`betsson`/`espnbet`
  among them, same "coverage isn't uniform" caveat already documented for The Odds API.

### Design

`apps/web/app/api/ingest/poll-api-football-odds/route.ts` runs as a third step in the
same daily job as `/api/ingest/poll` (`.github/workflows/poll-odds.yml`), **after** it
— it merges into rows that step already wrote, matched by team name (reusing
`team-name-matching.ts`'s exact-then-fuzzy logic, see
`apps/web/lib/ingest/fixture-matching.ts`) and a ±90 minute kickoff-time window, scoped
to the fixture's `sport_key` only. A fixture with no match yet gets inserted as a new
`odds_cache` row keyed `` `apifootball:${fixtureId}` `` instead of being dropped.

Fixture discovery (`ApiFootballClient.getOddsForLeagues` in `packages/api-football-client`)
calls `GET /fixtures?date=<date>` once (unfiltered, ~250-350 results worldwide),
filters client-side down to fixtures whose `league.id` is one of the 13 watched ones
(see the league map below), then makes one `GET /odds?fixture=<id>` call per matching
fixture — **not** the bulk `GET /odds?date=` endpoint (see the confirmed-live gap
above). A fixture with no bookmaker odds posted yet is skipped, not an error. This is
also cheaper than the abandoned bulk approach: most days only a handful of fixtures
fall in our 13 leagues out of the hundreds worldwide, versus paying for ~16 bulk pages
of mostly-irrelevant data every run regardless.

`odds_cache.bookmaker_odds` has no `provider` column — instead,
`packages/api-football-client` prefixes every bookmaker key it writes with `af:`
(`af:bet365`, `af:pinnacle`, ...) so it can never collide with a The Odds API key in the
same jsonb blob (both providers have a bookmaker literally named "Pinnacle"). The merge
itself is a Postgres jsonb `||` (`bookmaker_odds || <new af: keys>`), which only
overwrites the `af:`-namespaced keys this route owns — The Odds API's own keys, written
separately by `poll/route.ts`'s plain-overwrite upsert, are never touched by this route
and vice versa.

The one bet type semantically remapped rather than kept under its own key: API-Football's
"Match Winner" bet (outcome values are generic "Home"/"Draw"/"Away") is translated to
the fixture's real team names and written under the shared `h2h` market key — so a
Bet365/API-Football h2h price sits alongside The Odds API's bookmakers under the same
key, comparable in `build_combo`'s de-vig logic and gradable by the existing (unchanged)
`grade-h2h-leg.ts`, since that only keys off the `marketId` string and team-name
outcome strings, not which provider supplied them. Every other bet type keeps its own
slugified key (`asian_handicap`, `goals_over_under`, `both_teams_score`, ...) — see
`packages/mcp-tools/src/market-labels.ts` for which ones have a curated Spanish label
so far (unmapped keys fall back to their raw slug, not an error).

`apps/web/lib/ingest/api-football-league-map.ts` hand-maps the 13 watched soccer
`sport_key`s to API-Football's numeric league ids (all 13 verified live 2026-09-07 via
`GET /leagues?id=<id>`) — separate from `packages/mcp-tools/src/league-map.ts`'s
`LEAGUE_MAP` (that one is Highlightly-for-stats, unrelated). NBA/NFL/tennis have no
entry here — API-Football is soccer-only, so those sport_keys keep getting odds solely
from The Odds API, unchanged.

**Bookmaker allowlist is enforced in the client, not just the display layer.**
`apps/web/lib/bookmaker-links.ts`'s `BOOKMAKER_NAMES`/`BOOKMAKER_URLS` only control
display name/link — they do **not** filter which bookmakers actually get stored.
Confirmed live 2026-09-08 in the browser: without a real filter, every one of
API-Football's 33 possible bookmakers with odds for a fixture got merged into
`odds_cache` (17 bookmakers showing on one match's board), not just the two
(`bet365`/`1xbet`) the team's Argentina-focused bookmaker policy calls for. Fixed by
adding `ApiFootballClient.getOddsForLeagues`'s `allowedBookmakerNames` param — the
route passes `DEFAULT_API_FOOTBALL_BOOKMAKERS = ["bet365", "1xbet"]` (env-overridable
via `API_FOOTBALL_BOOKMAKERS`, same pattern as `ODDSAPI_BOOKMAKERS`), and a fixture
whose only bookmakers aren't on that list is skipped entirely rather than stored empty.

**Fixture-matching has a known, accepted gap: cross-provider team-name aliases.**
Confirmed live 2026-09-08: "VfB Stuttgart vs Viking" (The Odds API) vs "VfB Stuttgart
vs Viking FK" (API-Football) failed to match and created a visible duplicate fixture on
the Champions League board — fixed by adding `"fk"` to
`team-name-matching.ts`'s `GENERIC_CLUB_TOKENS` (same treatment as `"fc"`/`"sc"`/`"afc"`).
But "Sporting CP" (The Odds API) vs "Sporting Lisbon" (API-Football) is a real alias,
not an abbreviation-token difference Levenshtein can bridge (confirmed still
unmatched after the fix) — same real club, different exonym. No alias table was built
for this; a mismatch like it will keep silently inserting a duplicate row (which then
self-expires via the hourly cleanup cron once the fixture's kickoff passes, so it's a
cosmetic/transient issue, not a permanent one) until it's specifically special-cased.

### Budget

The route only queries **"tomorrow"** (1 day ahead) — `requests/day ≈ 1 (the
/fixtures?date= discovery call) + fixtures_in_our_13_leagues_that_day`. Live samples
for a single day: a quiet day had 0 matching fixtures (1 request total); a Champions
League/Libertadores/Sudamericana day had 9 matching fixtures (10 requests total). Even
a stacked matchday (Champions League's 36-team league phase can put ~18 matches on one
date, plus other watched leagues) stays comfortably under the 100/day Free-plan cap.
`MAX_FIXTURES_PER_RUN = 40` in the route is a defensive bound (mirrors
`MAX_H2H_FETCHES_PER_RUN`/`MAX_SPORTS_PER_RUN` elsewhere in this codebase), not a
budget calculation. Widening the look-ahead window (more than 1 day) or adding a second
run/day multiplies the per-day fixture count accordingly (`requests/day ≈ days_queried
× runs/day × (1 + matching_fixtures_per_day)`) — redo that math first. If quota ever
gets tight, the account holder has already said they're open to the Pro plan ($19/mo,
7,500/day) — free tier is enough for this integration's current scope, so there was no
reason to start there.

### Explicitly out of scope for this integration (see grading note above too)

- **Settlement/grading** for non-h2h legs was not built — see the note above.
- **NBA/NFL/tennis** odds are untouched — API-Football only ever supplies soccer.
- **Outrights/futures** (tournament winner, top scorer) were not added — `odds_cache`
  is keyed per fixture, not per tournament; that would need real schema/UI work.
- `API_FOOTBALL_API_KEY` is set locally (`apps/web/.env.local`) and, as of 2026-09-08,
  synced into the real production Vercel project too (see item 1 in "Next steps" for
  how) — unlike `ANTHROPIC_API_KEY`/`HIGHLIGHTLY_API_KEY`/`ODDSAPI_API_KEY`, which are
  still only local.

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

**Resolved incident (2026-09-08): all 3 ingest crons were silently broken for ~10 days.**
`poll-odds.yml`, `cleanup-odds.yml`, and `settle-bets.yml` had all been returning 401
Unauthorized on every run since 2026-08-28 — the `CRON_SECRET` stored in Vercel had
drifted from the `CRON_SECRET` GitHub secret at some point, and `sync-env.mjs`
deliberately never overwrites a key Vercel already has (see item 1 below), so nothing
ever re-synced it. Practical effect: `odds_cache` wasn't refreshing, expired fixtures
weren't being cleaned up, and no `bet_slip_legs` were being auto-settled for over a
week, with no visible error anywhere in the app itself (only in each workflow's own
Actions run log, which nobody was watching). Fixed by rotating `CRON_SECRET` to a new
value and force-syncing it into Vercel (production/preview/development) via a one-off
`workflow_dispatch` job (removed after use, see git history around 2026-09-08 if you
need the pattern again) — confirmed live afterward by hitting all 4 `/api/ingest/*`
routes directly with the new secret and getting 200s. **Lesson: these crons have no
alerting** — a future silent break like this one would only surface again by manually
checking each workflow's run history (`gh run list --workflow=<name>.yml`), which is
exactly how this one was found (while verifying the API-Football integration below).
Worth adding real alerting (e.g. a Slack/email ping on workflow failure) at some point.

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
   normally requires whoever holds the `VERCEL_TOKEN` secret to run `vercel env add`
   against that project, or to grant CLI access to `team_klaQ4k4O3uyzx9gNCCsGWN91` —
   **but there's a lower-friction path that doesn't need either**: `deploy.yml`'s
   "Sync missing env vars to Vercel" step runs `.github/scripts/sync-env.mjs` on every
   deploy, which pushes any GitHub repo secret not yet present in Vercel (all three
   environments) using the `VERCEL_TOKEN` secret the workflow already has — it only
   adds missing keys, never overwrites existing ones. Confirmed working live
   2026-09-07: adding `API_FOOTBALL_API_KEY` as a GitHub secret and triggering
   `deploy.yml` via `workflow_dispatch` synced it into Vercel production/preview/
   development without needing direct Vercel access at all.
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
   project (see item 1).
8. **`CLERK_WEBHOOK_SIGNING_SECRET` is not set anywhere** (not `.env.local`, not GitHub
   secrets, so not synced to Vercel either) — found 2026-09-04 while debugging "aceptar
   apuesta" silently failing to save. `apps/web/app/api/webhooks/clerk/route.ts` (which
   would create/update a `users` row on Clerk's `user.created`/`user.updated` events)
   always 500s without it, so it's never actually run in this app. This stopped being a
   correctness bug for `bet_slips` (which FKs `users.id` NOT NULL) once `saveBetSlip()`
   started calling `ensureUserExists()` itself (see `packages/db/src/users.ts`) instead
   of assuming the webhook or `consumeRun`'s admin-skipped `ensureUser` call already
   created the row — but the webhook itself is still dead weight and any future
   `users`-FK'd write should not assume Clerk data (email, display name) is synced
   in from the webhook; it'll have whatever placeholder `ensureUserExists` wrote
   (`<clerkId>@pending.betia`, no display name) until something else corrects it. Fix
   by adding the real secret from the Clerk dashboard's webhook config, once someone
   sets up the endpoint there.
