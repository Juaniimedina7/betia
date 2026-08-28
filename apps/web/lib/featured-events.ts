import { getOdds, listFixtures, listSports, listTournaments, type MarketInfo } from "@bet/mcp-tools";
import type { BookmakerOdds, Fixture } from "@bet/oddspapi-client";

/** A fixture is treated as in-play from kickoff until this long after it. */
const LIVE_WINDOW_MS = 4 * 60 * 60 * 1000;

/** How far ahead the board looks. Anything later isn't "hoy". */
const UPCOMING_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Fixtures pulled per sport before the odds fan-out. Keeps the board mixed. */
const CANDIDATES_PER_SPORT = 4;

/** Hard cap on concurrent getOdds calls — each one may miss Redis and go live. */
const CANDIDATE_LIMIT = 12;

const MAX_EVENTS = 6;

/**
 * Each supported sport's main "who wins" market. Same list `live-odds-table.tsx`
 * floats to the top of the odds board.
 */
const PRIORITY_MARKET_IDS = ["101", "111", "121", "261"];

const PINNACLE_KEYS = ["pinnacle", "pinnacle.com"];

export interface FeaturedPick {
  /** Human-readable selection from the market catalog, e.g. "Boca Juniors" / "Empate". */
  label: string;
  price: number;
  edgePct: number;
  /** Highest-edge selection of the fixture — rendered as the value price. */
  best: boolean;
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
}

export interface FeaturedEventsResult {
  events: FeaturedEvent[];
  /** "cache" when any leg of the pipeline fell back to stored data — the flag `/odds/[sportId]` also shows. */
  source: "live" | "cache";
  cachedAt: string | undefined;
  error: string | null;
}

interface Selection {
  outcomeId: string;
  playerIdx: string;
  /** Best price across every bookmaker quoting it. */
  price: number;
  /** Sharp/consensus price used as the fair-value reference. */
  referencePrice: number;
  edgePct: number;
}

/**
 * Featured fixtures for the logged-in dashboard, fetched the way the odds pages
 * do it: `listSports` for the in-scope sports, `listFixtures` per sport for
 * what's playable in the window, then `getOdds` per candidate — each of those
 * already falls back live → Redis → Postgres on its own, so the board degrades
 * instead of failing. Never throws; the dashboard renders its own empty state.
 */
export async function getFeaturedEvents(): Promise<FeaturedEventsResult> {
  let source: "live" | "cache" = "live";
  let cachedAt: string | undefined;

  const noteSource = (s: string, at: string | undefined) => {
    if (s === "live" || s === "redis") return;
    source = "cache";
    // Surface the stalest timestamp we saw — that's the real age of the board.
    if (at && (!cachedAt || at < cachedAt)) cachedAt = at;
  };

  try {
    const sportsResult = await listSports({});
    noteSource(sportsResult.source, sportsResult.cachedAt);
    const sportNames = new Map(sportsResult.sports.map((s) => [s.sportId, s.name]));

    const now = Date.now();
    // Reach back before kickoff so in-play matches reach the "En vivo" tab, and
    // only as far forward as the board claims to cover.
    const from = new Date(now - LIVE_WINDOW_MS).toISOString();
    const to = new Date(now + UPCOMING_WINDOW_MS).toISOString();

    const perSport = await Promise.all(
      sportsResult.sports.map(async (sport) => {
        try {
          const result = await listFixtures({ sportId: sport.sportId, from, to });
          noteSource(result.source, result.cachedAt);
          return result.fixtures.slice(0, CANDIDATES_PER_SPORT);
        } catch {
          // One dead sport shouldn't empty the whole board.
          return [];
        }
      }),
    );

    // Round-robin across sports so soccer's volume doesn't crowd everything out.
    const candidates: Fixture[] = [];
    for (let i = 0; i < CANDIDATES_PER_SPORT; i++) {
      for (const fixtures of perSport) {
        const fixture = fixtures[i];
        if (fixture) candidates.push(fixture);
      }
    }

    const priced = await Promise.all(
      candidates.slice(0, CANDIDATE_LIMIT).map(async (fixture) => {
        try {
          const odds = await getOdds({ fixtureId: fixture.fixtureId });
          if (odds.source === "db-cache") noteSource(odds.source, odds.cachedAt);
          return {
            fixture,
            matchup: odds.matchup,
            bookmakerOdds: odds.bookmakerOdds,
            catalog: odds.marketCatalog,
          };
        } catch {
          return null;
        }
      }),
    );

    const events: FeaturedEvent[] = [];
    for (const entry of priced) {
      if (!entry) continue;
      const { fixture, matchup, bookmakerOdds, catalog } = entry;

      const headline = headlineMarket(bookmakerOdds);
      if (!headline) continue;

      const bestEdge = Math.max(...headline.selections.map((s) => s.edgePct));
      const kickoff = new Date(fixture.startTime).getTime();

      events.push({
        fixtureId: fixture.fixtureId,
        sportId: fixture.sportId,
        sportName: sportNames.get(fixture.sportId) ?? fixture.sportId,
        tournamentId: fixture.tournamentId,
        tournamentName: sportNames.get(fixture.sportId) ?? fixture.sportId,
        participant1: fixture.participant1Name ?? matchup?.participant1Name ?? fixture.participant1Id,
        participant2: fixture.participant2Name ?? matchup?.participant2Name ?? fixture.participant2Id,
        startTime: fixture.startTime,
        live: kickoff <= now && now - kickoff < LIVE_WINDOW_MS,
        edgePct: bestEdge,
        picks: headline.selections.map((selection) => ({
          label: selectionLabel(headline.marketId, selection, headline.selections.length, catalog),
          price: selection.price,
          edgePct: selection.edgePct,
          best: selection.edgePct === bestEdge,
        })),
      });
    }

    events.sort((a, b) => b.edgePct - a.edgePct);
    const top = events.slice(0, MAX_EVENTS);

    await decorateTournaments(top);
    return { events: top, source, cachedAt, error: null };
  } catch (e) {
    return {
      events: [],
      source,
      cachedAt,
      error: e instanceof Error ? e.message : "No se pudieron cargar los partidos",
    };
  }
}

/**
 * Prices one fixture's markets and returns the headline one: the sport's main
 * "who wins" market when it's quoted, else the fullest complete book.
 *
 * The edge math lives here rather than in `@bet/combo-engine` because that
 * package de-vigs across the *players* inside a single outcome, while OddsPapi
 * models each selection as its own `outcomeId` with a lone player "0" — see the
 * market catalog, whose outcome names are "1" / "X" / "2" / "Over" / "Under".
 */
function headlineMarket(
  bookmakerOdds: BookmakerOdds,
): { marketId: string; selections: Selection[] } | null {
  const books = Object.entries(bookmakerOdds ?? {});
  if (books.length === 0) return null;

  const pinnacleKey = Object.keys(bookmakerOdds).find((k) => PINNACLE_KEYS.includes(k.toLowerCase()));

  // marketId -> selection key -> prices quoted by each bookmaker
  const quotes = new Map<string, Map<string, { prices: number[]; pinnacle?: number }>>();

  for (const [bookmaker, book] of books) {
    for (const [marketId, market] of Object.entries(book.markets ?? {})) {
      for (const [outcomeId, outcome] of Object.entries(market.outcomes)) {
        for (const [playerIdx, player] of Object.entries(outcome.players)) {
          if (player.active === false || player.price <= 1 || (player.limit ?? 1) <= 0) continue;
          const byMarket = quotes.get(marketId) ?? new Map();
          quotes.set(marketId, byMarket);
          const key = `${outcomeId}::${playerIdx}`;
          const entry = byMarket.get(key) ?? { prices: [] };
          entry.prices.push(player.price);
          if (bookmaker === pinnacleKey) entry.pinnacle = player.price;
          byMarket.set(key, entry);
        }
      }
    }
  }

  const priced: Array<{ marketId: string; selections: Selection[] }> = [];

  for (const [marketId, byKey] of quotes) {
    // Only a complete two- or three-way book normalizes to a meaningful 100%.
    // Anything else (props, multi-line totals sharing an id) can't be de-vigged.
    if (byKey.size !== 2 && byKey.size !== 3) continue;

    const rows = [...byKey.entries()].map(([key, entry]) => {
      const [outcomeId, playerIdx] = key.split("::") as [string, string];
      return {
        outcomeId,
        playerIdx,
        price: Math.max(...entry.prices),
        referencePrice: entry.pinnacle ?? median(entry.prices),
      };
    });

    // Multiplicative de-vig across the market's selections: strip the book's
    // margin so the implied probabilities sum to 1, then compare the best
    // available price against that fair probability.
    const overround = rows.reduce((sum, r) => sum + 1 / r.referencePrice, 0);
    if (overround <= 0) continue;

    priced.push({
      marketId,
      selections: rows
        .map((r) => {
          const fairProbability = 1 / r.referencePrice / overround;
          return { ...r, edgePct: (r.price * fairProbability - 1) * 100 };
        })
        .sort((a, b) => Number(a.outcomeId) - Number(b.outcomeId)),
    });
  }

  if (priced.length === 0) return null;

  return priced.sort((a, b) => {
    const ai = PRIORITY_MARKET_IDS.indexOf(a.marketId);
    const bi = PRIORITY_MARKET_IDS.indexOf(b.marketId);
    if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    if (a.selections.length !== b.selections.length) return b.selections.length - a.selections.length;
    return Number(a.marketId) - Number(b.marketId);
  })[0]!;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

/**
 * Real outcome name from the market catalog ("Boca Juniors", "Empate", "Más de"),
 * falling back to the positional 1/X/2 when the catalog hasn't been seeded for
 * this market yet. Mirrors `live-odds-table.tsx`'s label rule.
 */
function selectionLabel(
  marketId: string,
  selection: Selection,
  count: number,
  catalog: Record<string, MarketInfo>,
): string {
  const fromCatalog = catalog[marketId]?.outcomes[selection.outcomeId];
  const base =
    fromCatalog ??
    (count === 3
      ? ({ "1": "1", "2": "X", "3": "2" }[selection.outcomeId] ?? selection.outcomeId)
      : selection.outcomeId);
  return selection.playerIdx === "0" ? base : `${base} (${selection.playerIdx})`;
}

/** Resolves tournament ids to names. Best-effort: the sport name stays on failure. */
async function decorateTournaments(events: FeaturedEvent[]): Promise<void> {
  if (events.length === 0) return;

  try {
    const sportIds = [...new Set(events.map((e) => e.sportId))];
    const lists = await Promise.all(
      sportIds.map((sportId) => listTournaments({ sportId }).catch(() => ({ tournaments: [] }))),
    );
    const names = new Map(
      lists.flatMap(({ tournaments }) => tournaments.map((t) => [t.tournamentId, t.name] as const)),
    );

    for (const event of events) {
      event.tournamentName = names.get(event.tournamentId) ?? event.tournamentName;
    }
  } catch {
    // Names are cosmetic — the sport name already reads fine.
  }
}
