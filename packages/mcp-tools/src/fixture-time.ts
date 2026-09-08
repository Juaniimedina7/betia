import { oddsCache } from "@bet/db";
import { sql, type SQL } from "drizzle-orm";

// Shared "has this fixture already started" check. `odds_cache` has no status/finished
// column — commence_time vs wall-clock time is the only signal. Extracted so every
// odds-serving tool (build_combo, list_fixtures, get_odds_by_tournament,
// find_player_props, get_odds, get_best_price) applies the exact same defensive floor
// instead of relying solely on the hourly cleanup cron (/api/ingest/cleanup), which
// only sweeps already-started fixtures out of odds_cache up to an hour after kickoff.

/**
 * Drizzle condition: true when a row's effective kickoff time is still in the future.
 * Coalesces to `updatedAt` when `commenceTime` is null (it's a nullable column, and
 * every existing mapper in this package already falls back to updatedAt the same way)
 * — a bare `gte(commenceTime, now)` would silently drop every null-commenceTime row
 * instead of just excluding started ones, since `NULL >= x` is NULL in Postgres, not
 * true. drizzle-orm 0.45 doesn't export a `coalesce` helper, hence the raw `sql`
 * fragment instead of a builder-function composition.
 */
export function notStartedCondition(now: Date = new Date()): SQL {
  return sql`coalesce(${oddsCache.commenceTime}, ${oddsCache.updatedAt}) >= ${now}`;
}

/** Same check for a single already-fetched row, for by-id lookup tools. */
export function hasFixtureStarted(commenceTime: Date | null, updatedAt: Date, now: Date = new Date()): boolean {
  return (commenceTime ?? updatedAt) < now;
}
