import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const planIds = ["free", "starter", "pro"] as const;

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user id
  email: text("email").notNull(),
  displayName: text("display_name"),
  plan: text("plan", { enum: planIds }).notNull().default("free"),
  planStatus: text("plan_status", { enum: ["active", "paused", "cancelled"] })
    .notNull()
    .default("active"),
  mpPreapprovalId: text("mp_preapproval_id"),
  planUpdatedAt: timestamp("plan_updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per user per calendar month (YYYY-MM); counts consumed agent runs. */
export const monthlyUsage = pgTable(
  "monthly_usage",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // e.g. "2026-08"
    runCount: integer("run_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.userId, table.period),
    index("monthly_usage_user_id_idx").on(table.userId),
  ],
);

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const betSlipStatus = [
  "draft",
  "saved",
  "placed_by_user",
  "won",
  "lost",
  "void",
  "push",
] as const;

export const betSlips = pgTable("bet_slips", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  status: text("status", { enum: betSlipStatus }).notNull().default("draft"),
  combinedOddsDecimal: numeric("combined_odds_decimal", { precision: 10, scale: 2 }).notNull(),
  stakeReference: numeric("stake_reference", { precision: 10, scale: 2 }),
  potentialPayout: numeric("potential_payout", { precision: 12, scale: 2 }),
  currency: text("currency").notNull().default("USD"),
  source: text("source", { enum: ["agent", "manual"] })
    .notNull()
    .default("agent"),
  reasoning: text("reasoning"),
  constraints: jsonb("constraints"),
  userMarkedOutcome: text("user_marked_outcome", { enum: ["won", "lost", "void"] }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

export const betSlipLegs = pgTable(
  "bet_slip_legs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    betSlipId: uuid("bet_slip_id")
      .notNull()
      .references(() => betSlips.id, { onDelete: "cascade" }),
    legIndex: smallint("leg_index").notNull(),
    fixtureId: text("fixture_id").notNull(),
    sportId: text("sport_id").notNull(),
    tournamentId: text("tournament_id").notNull(),
    participant1Id: text("participant1_id").notNull(),
    participant2Id: text("participant2_id").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    marketId: text("market_id").notNull(),
    outcomeId: text("outcome_id").notNull(),
    selectionLabel: text("selection_label").notNull(),
    bookmaker: text("bookmaker").notNull(),
    priceDecimal: numeric("price_decimal", { precision: 8, scale: 3 }).notNull(),
    fairPriceDecimal: numeric("fair_price_decimal", { precision: 8, scale: 3 }),
    edgePct: numeric("edge_pct", { precision: 6, scale: 3 }),
    status: text("status", { enum: ["pending", "won", "lost", "void"] })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.betSlipId, table.legIndex),
    index("bet_slip_legs_fixture_id_idx").on(table.fixtureId),
    index("bet_slip_legs_bet_slip_id_idx").on(table.betSlipId),
  ],
);

/**
 * Best-effort backup of the last known /v4/sports response, used when the live API is
 * unreachable. `active` matters most for tennis: The Odds API has no year-round
 * "ATP/WTA tour" sport_key the way soccer has stable leagues — each tournament
 * (Wimbledon, US Open, etc.) is its own sport_key that's only `active` during that
 * ~1-2 week window each year. `apps/web/lib/ingest/watched-sport-keys.ts` reads this
 * column every run to discover which tennis tournaments are currently worth polling,
 * instead of hardcoding a tournament list the way soccer/NBA/NFL are hardcoded.
 */
export const sportsCache = pgTable("sports_cache", {
  sportKey: text("sport_key").primaryKey(),
  group: text("group").notNull(),
  title: text("title").notNull(),
  active: boolean("active").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Last known event metadata + odds per event, upserted by the ingest cron only.
 * Serves as a durable backup (unlike the 120s-TTL Redis cache) so `/odds`,
 * `/odds/[sportId]` and `/fixtures/[fixtureId]` — none of which call the live API
 * themselves — always have something to read.
 */
export const oddsCache = pgTable(
  "odds_cache",
  {
    eventId: text("event_id").primaryKey(),
    sportKey: text("sport_key").notNull(),
    sportTitle: text("sport_title"),
    homeTeam: text("home_team"),
    awayTeam: text("away_team"),
    commenceTime: timestamp("commence_time", { withTimezone: true }),
    bookmakerOdds: jsonb("bookmaker_odds"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("odds_cache_sport_key_idx").on(table.sportKey)],
);

/**
 * Resolves a team name (scoped to the sport_key it was seen in) to its external
 * (Highlightly) team id by name, cached so repeated ingestion runs don't re-match
 * every time. A null externalTeamId means a resolution attempt was made and failed
 * to find a confident match (retried on a slower cadence than a fresh/never-tried
 * team). `teamKey` is `${sportKey}:${slug(teamName)}` — the odds provider has no
 * stable participant id, only name strings, so this is the tightest collision
 * boundary available (the same real-world club playing in two watched competitions
 * gets two independent rows, matching how resolution already worked per-tournament).
 */
export const teamIdMap = pgTable("team_id_map", {
  teamKey: text("team_key").primaryKey(),
  teamName: text("team_name").notNull(),
  externalTeamId: text("external_team_id"),
  matchedTeamName: text("matched_team_name"),
  matchStrategy: text("match_strategy", { enum: ["exact", "fuzzy", "unresolved"] }).notNull(),
  matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-team season stats (home/away split), raw counts only — the statistical
 * probability model (packages/stats-engine) derives rates/strength from these on the
 * fly, nothing is pre-averaged here. Currently sourced from Highlightly's
 * `/standings` endpoint, one call per league covering every team at once.
 */
export const teamSeasonStats = pgTable(
  "team_season_stats",
  {
    externalTeamId: text("external_team_id").notNull(),
    leagueId: text("league_id").notNull(),
    season: text("season").notNull(), // e.g. "2026"
    teamName: text("team_name").notNull(),
    matchesPlayedHome: integer("matches_played_home").notNull().default(0),
    matchesPlayedAway: integer("matches_played_away").notNull().default(0),
    winsHome: integer("wins_home").notNull().default(0),
    winsAway: integer("wins_away").notNull().default(0),
    drawsHome: integer("draws_home").notNull().default(0),
    drawsAway: integer("draws_away").notNull().default(0),
    lossesHome: integer("losses_home").notNull().default(0),
    lossesAway: integer("losses_away").notNull().default(0),
    goalsForHome: integer("goals_for_home").notNull().default(0),
    goalsForAway: integer("goals_for_away").notNull().default(0),
    goalsAgainstHome: integer("goals_against_home").notNull().default(0),
    goalsAgainstAway: integer("goals_against_away").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.externalTeamId, table.leagueId, table.season] }),
    index("team_season_stats_league_idx").on(table.leagueId, table.season),
  ],
);

/**
 * Head-to-head summary between a pair of external (Highlightly) team ids, normalized
 * so teamAId < teamBId (lexicographically) — callers must sort the two resolved ids
 * before reading/writing so a pair is never stored/duplicated in both orderings.
 */
export const teamHeadToHead = pgTable(
  "team_head_to_head",
  {
    teamAId: text("team_a_id").notNull(),
    teamBId: text("team_b_id").notNull(),
    matchesPlayed: integer("matches_played").notNull().default(0),
    teamAWins: integer("team_a_wins").notNull().default(0),
    teamBWins: integer("team_b_wins").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    teamAGoalsFor: integer("team_a_goals_for").notNull().default(0),
    teamBGoalsFor: integer("team_b_goals_for").notNull().default(0),
    lastMeetingAt: timestamp("last_meeting_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.teamAId, table.teamBId] })],
);

export const usersRelations = relations(users, ({ many }) => ({
  betSlips: many(betSlips),
  apiTokens: many(apiTokens),
}));

export const betSlipsRelations = relations(betSlips, ({ one, many }) => ({
  user: one(users, { fields: [betSlips.userId], references: [users.id] }),
  legs: many(betSlipLegs),
}));

export const betSlipLegsRelations = relations(betSlipLegs, ({ one }) => ({
  betSlip: one(betSlips, { fields: [betSlipLegs.betSlipId], references: [betSlips.id] }),
}));
