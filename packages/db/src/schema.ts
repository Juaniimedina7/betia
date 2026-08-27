import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
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

/** Best-effort backup of the last known /v4/sports response, used when OddsPapi is unreachable. */
export const sportsCache = pgTable("sports_cache", {
  sportId: text("sport_id").primaryKey(),
  name: text("name").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Last known fixture metadata + odds per fixture, upserted whenever a live OddsPapi
 * call succeeds. Serves as a durable backup (unlike the 120s-TTL Redis cache) so
 * `/odds`, `/odds/[sportId]` and `/fixtures/[fixtureId]` still have something to show
 * when the live API fails.
 */
export const oddsCache = pgTable(
  "odds_cache",
  {
    fixtureId: text("fixture_id").primaryKey(),
    sportId: text("sport_id").notNull(),
    tournamentId: text("tournament_id"),
    participant1Id: text("participant1_id"),
    participant2Id: text("participant2_id"),
    participant1Name: text("participant1_name"),
    participant2Name: text("participant2_name"),
    startTime: timestamp("start_time", { withTimezone: true }),
    statusId: text("status_id"),
    bookmakerOdds: jsonb("bookmaker_odds"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("odds_cache_sport_id_idx").on(table.sportId)],
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
