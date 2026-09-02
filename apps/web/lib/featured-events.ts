import { getDb, oddsCache } from "@bet/db";
import { estimateMatchProbability } from "@bet/mcp-tools";
import type { BookmakerOdds } from "@bet/odds-api-client";
import { and, gte, isNotNull, lte } from "drizzle-orm";

/** A fixture is treated as in-play from kickoff until this long after it. */
const LIVE_WINDOW_MS = 4 * 60 * 60 * 1000;

/** How far ahead the board looks. Anything later isn't "hoy". */
const UPCOMING_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Fixtures pulled per sport_key before picking the best-edge ones. Keeps the board mixed. */
const CANDIDATES_PER_SPORT_KEY = 4;

const MAX_EVENTS = 6;

/** Same list `live-odds-table.tsx` floats to the top of the odds board. */
const PRIORITY_MARKET_IDS = ["h2h", "spreads", "totals"];

const PINNACLE_KEYS = ["pinnacle", "pinnacle.com"];

// Product scope: every watched league is soccer today — see watched-sport-keys.ts and
// list-sports.ts's SPANISH_GROUP_NAMES. No group column lives on odds_cache itself, so
// this is hardcoded rather than queried; revisit once non-soccer leagues are ingested.
const SPORT_NAME = "Fútbol";

export interface FeaturedPick {
  /** Human-readable selection — the outcome name (a team name, "Empate", "Más de 2.5", etc). */
  label: string;
  price: number;
  edgePct: number;
  /** Highest-edge selection of the fixture — rendered as the value price. */
  best: boolean;
}

/**
 * Statistical (Poisson) probability — separate from `edgePct`/`picks`, which are
 * market-implied. Null when there isn't enough ingested history yet (see
 * `estimate_match_probability` in `@bet/mcp-tools`); never mixed into the same
 * number as the market edge.
 */
export interface FeaturedStatisticalProbability {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
}

export interface FeaturedEvent {
  fixtureId: string;
  sportId: string;
  sportName: string;
  tournamentId: string;
  tournamentName: string;
  participant1: string;
  participant2: string;
  startTime: string;
  live: boolean;
  /** Best edge across the fixture's selections, in percent. */
  edgePct: number;
  picks: FeaturedPick[];
  statisticalProbability: FeaturedStatisticalProbability | null;
}

export interface FeaturedEventsResult {
  events: FeaturedEvent[];
  error: string | null;
}

interface Selection {
  outcomeName: string;
  point?: number;
  /** Best price across every bookmaker quoting it. */
  price: number;
  /** Sharp/consensus price used as the fair-value reference. */
  referencePrice: number;
  edgePct: number;
}

/**
 * Featured fixtures for the logged-in dashboard — a single DB read of odds_cache
 * (populated by /api/ingest/poll; never a live call here or anywhere else in the web
 * app). Never throws; the dashboard renders its own empty state.
 */
export async function getFeaturedEvents(): Promise<FeaturedEventsResult> {
  try {
    const now = Date.now();
    // Reach back before kickoff so in-play matches reach the "En vivo" tab, and
    // only as far forward as the board claims to cover.
    const from = new Date(now - LIVE_WINDOW_MS);
    const to = new Date(now + UPCOMING_WINDOW_MS);

    const rows = await getDb()
      .select()
      .from(oddsCache)
      .where(and(isNotNull(oddsCache.bookmakerOdds), gte(oddsCache.commenceTime, from), lte(oddsCache.commenceTime, to)))
      .orderBy(oddsCache.commenceTime);

    // Round-robin across sport_keys so one big league doesn't crowd everything out.
    const bySportKey = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = bySportKey.get(row.sportKey) ?? [];
      if (bucket.length < CANDIDATES_PER_SPORT_KEY) bucket.push(row);
      bySportKey.set(row.sportKey, bucket);
    }
    const candidates: typeof rows = [];
    for (let i = 0; i < CANDIDATES_PER_SPORT_KEY; i++) {
      for (const bucket of bySportKey.values()) {
        const row = bucket[i];
        if (row) candidates.push(row);
      }
    }

    const events: FeaturedEvent[] = [];
    // fixtureId -> {homeTeam, awayTeam, sportKey}, kept alongside `events` so the
    // statistical-probability decoration pass below doesn't need to re-derive them.
    const teamsByFixture = new Map<string, { homeTeam: string; awayTeam: string; sportKey: string }>();

    for (const row of candidates) {
      const bookmakerOdds = (row.bookmakerOdds as BookmakerOdds) ?? {};
      const headline = headlineMarket(bookmakerOdds, row.homeTeam ?? undefined, row.awayTeam ?? undefined);
      if (!headline) continue;

      const bestEdge = Math.max(...headline.selections.map((s) => s.edgePct));
      const kickoff = (row.commenceTime ?? row.updatedAt).getTime();

      events.push({
        fixtureId: row.eventId,
        sportId: row.sportKey,
        sportName: SPORT_NAME,
        tournamentId: row.sportKey,
        tournamentName: row.sportTitle ?? row.sportKey,
        participant1: row.homeTeam ?? "?",
        participant2: row.awayTeam ?? "?",
        startTime: (row.commenceTime ?? row.updatedAt).toISOString(),
        live: kickoff <= now && now - kickoff < LIVE_WINDOW_MS,
        edgePct: bestEdge,
        picks: headline.selections.map((selection) => ({
          label: selectionLabel(selection),
          price: selection.price,
          edgePct: selection.edgePct,
          best: selection.edgePct === bestEdge,
        })),
        statisticalProbability: null,
      });
      if (row.homeTeam && row.awayTeam) {
        teamsByFixture.set(row.eventId, { homeTeam: row.homeTeam, awayTeam: row.awayTeam, sportKey: row.sportKey });
      }
    }

    events.sort((a, b) => b.edgePct - a.edgePct);
    const top = events.slice(0, MAX_EVENTS);

    await decorateStatisticalProbability(top, teamsByFixture);
    return { events: top, error: null };
  } catch (e) {
    return {
      events: [],
      error: e instanceof Error ? e.message : "No se pudieron cargar los partidos",
    };
  }
}

/**
 * Prices one event's markets and returns the headline one: the sport's main
 * "who wins" market when it's quoted, else the fullest complete book. For h2h, the
 * outcome name already IS the display label (a team name, or "Draw") — no catalog
 * lookup needed, unlike OddsPapi where outcomes were opaque ids.
 */
function headlineMarket(
  bookmakerOdds: BookmakerOdds,
  homeTeam: string | undefined,
  awayTeam: string | undefined,
): { marketId: string; selections: Selection[] } | null {
  const books = Object.entries(bookmakerOdds ?? {});
  if (books.length === 0) return null;

  const pinnacleKey = Object.keys(bookmakerOdds).find((k) => PINNACLE_KEYS.includes(k.toLowerCase()));

  // marketId -> selection key -> prices quoted by each bookmaker
  const quotes = new Map<string, Map<string, { outcomeName: string; point?: number; prices: number[]; pinnacle?: number }>>();

  for (const [bookmaker, book] of books) {
    for (const [marketId, market] of Object.entries(book.markets ?? {})) {
      for (const outcome of market.outcomes) {
        if (outcome.price <= 1) continue;
        const byMarket = quotes.get(marketId) ?? new Map();
        quotes.set(marketId, byMarket);
        const key = `${outcome.name}|${outcome.point ?? ""}`;
        const entry = byMarket.get(key) ?? { outcomeName: outcome.name, point: outcome.point, prices: [] };
        entry.prices.push(outcome.price);
        if (bookmaker === pinnacleKey) entry.pinnacle = outcome.price;
        byMarket.set(key, entry);
      }
    }
  }

  const priced: Array<{ marketId: string; selections: Selection[] }> = [];

  for (const [marketId, byKey] of quotes) {
    // Only a complete two- or three-way book normalizes to a meaningful 100%.
    if (byKey.size !== 2 && byKey.size !== 3) continue;

    const rows = [...byKey.values()].map((entry) => ({
      outcomeName: entry.outcomeName,
      point: entry.point,
      price: Math.max(...entry.prices),
      referencePrice: entry.pinnacle ?? median(entry.prices),
    }));

    const overround = rows.reduce((sum, r) => sum + 1 / r.referencePrice, 0);
    if (overround <= 0) continue;

    priced.push({
      marketId,
      selections: rows
        .map((r) => {
          const fairProbability = 1 / r.referencePrice / overround;
          return { ...r, edgePct: (r.price * fairProbability - 1) * 100 };
        })
        .sort((a, b) => outcomeOrder(a.outcomeName, homeTeam, awayTeam) - outcomeOrder(b.outcomeName, homeTeam, awayTeam)),
    });
  }

  if (priced.length === 0) return null;

  return priced.sort((a, b) => {
    const ai = PRIORITY_MARKET_IDS.indexOf(a.marketId);
    const bi = PRIORITY_MARKET_IDS.indexOf(b.marketId);
    if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return b.selections.length - a.selections.length;
  })[0]!;
}

/** Home team first, Draw in the middle, away team last — falls back to source order. */
function outcomeOrder(name: string, homeTeam: string | undefined, awayTeam: string | undefined): number {
  if (name === homeTeam) return 0;
  if (name === "Draw") return 1;
  if (name === awayTeam) return 2;
  return 3;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

function selectionLabel(selection: Selection): string {
  if (selection.outcomeName === "Draw") return "Empate";
  if (selection.point === undefined) return selection.outcomeName;
  return `${selection.outcomeName} (${selection.point > 0 ? "+" : ""}${selection.point})`;
}

/**
 * Statistical (Poisson) win/draw/loss estimate per event, DB-only (see
 * estimate_match_probability in @bet/mcp-tools — never a live Highlightly call, so
 * this never competes with the ingestion cron's request budget). Best-effort: a
 * missing/incomplete mapping just leaves `statisticalProbability: null`, which the UI
 * renders as "sin datos" rather than erroring the whole board.
 */
async function decorateStatisticalProbability(
  events: FeaturedEvent[],
  teamsByFixture: Map<string, { homeTeam: string; awayTeam: string; sportKey: string }>,
): Promise<void> {
  await Promise.all(
    events.map(async (event) => {
      const teams = teamsByFixture.get(event.fixtureId);
      if (!teams) return;
      try {
        const result = await estimateMatchProbability({
          homeTeam: teams.homeTeam,
          awayTeam: teams.awayTeam,
          sportKey: teams.sportKey,
        });
        if (result.available) {
          event.statisticalProbability = result.statisticalProbability;
        }
      } catch {
        // Leave statisticalProbability: null — the market edge is still shown either way.
      }
    }),
  );
}
