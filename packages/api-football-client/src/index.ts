import type { ApiFootballBookmakerOdds, ApiFootballFixtureOdds, ApiFootballMarketQuote, QuotaSnapshot } from "./types";

export * from "./types";

const DEFAULT_HOST = "https://v3.football.api-sports.io";
const DEFAULT_TIMEOUT_MS = 10_000;
// Confirmed live 2026-09-07 against the Free plan: x-ratelimit-limit is 10/minute.
// Pacing page fetches at this interval keeps a run comfortably under that (~9.2/min)
// without needing a 429-triggered backoff for the common case — see CLAUDE.md's
// "API-Football odds quota" section for the full budget math this pacing is based on.
const PAGE_FETCH_INTERVAL_MS = 6_500;

// The raw response shapes below mirror what api-sports.io's /odds and /odds/bookmakers
// endpoints actually return (confirmed live, not from docs alone) — snake_case is
// mixed with API-Football's own camelCase-ish field names, which is why this
// normalization layer exists rather than trusting the raw shape everywhere else.
interface RawOddsValue {
  value: string;
  odd: string;
}

interface RawOddsBet {
  id: number;
  name: string;
  values: RawOddsValue[];
}

interface RawOddsBookmaker {
  id: number;
  name: string;
  bets: RawOddsBet[];
}

interface RawOddsFixtureEntry {
  league: { id: number; season: number };
  fixture: { id: number; date: string };
  bookmakers: RawOddsBookmaker[];
}

interface RawOddsResponse {
  response: RawOddsFixtureEntry[];
  errors: unknown;
  paging: { current: number; total: number };
}

interface RawFixtureTeams {
  home: { name: string };
  away: { name: string };
}

interface RawFixtureEntry {
  fixture: { id: number };
  teams: RawFixtureTeams;
}

interface RawFixturesResponse {
  response: RawFixtureEntry[];
  errors: unknown;
}

/** "Both Teams Score" -> "both_teams_score". Used as the market key inside bookmakerOdds. */
function slugifyMarketName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** "Bet365" -> "af:bet365". Namespaced so it never collides with a The Odds API key. */
function bookmakerKeyFor(name: string): string {
  return `af:${slugifyMarketName(name)}`;
}

/**
 * "Match Winner" is the one bet type worth aligning with The Odds API's "h2h" market
 * key: same real-world market (who wins the match), and merging it in means a Bet365/
 * Pinnacle-via-API-Football h2h price sits alongside The Odds API's own bookmakers
 * under the same "h2h" key — visible to build_combo's de-vig comparison, and gradable
 * by the existing (unmodified) grade-h2h-leg.ts, since that only cares about the
 * marketId string and the team-name outcome strings, not which provider supplied them.
 *
 * API-Football's raw outcome values for this market are generic "Home"/"Draw"/"Away"
 * (not team names), so they're translated here using the fixture's own team names to
 * match The Odds API's outcome shape (team name string, or "Draw").
 */
function normalizeMatchWinnerOutcome(value: string, homeTeam: string, awayTeam: string): string {
  if (value === "Home") return homeTeam;
  if (value === "Away") return awayTeam;
  return value; // "Draw" already matches The Odds API's own outcome name for a tie.
}

function normalizeBookmakers(
  rawBookmakers: RawOddsBookmaker[],
  homeTeam: string,
  awayTeam: string,
): ApiFootballBookmakerOdds {
  const bookmakerOdds: ApiFootballBookmakerOdds = {};
  for (const rawBookmaker of rawBookmakers) {
    const markets: Record<string, ApiFootballMarketQuote> = {};
    for (const bet of rawBookmaker.bets) {
      const isMatchWinner = bet.name === "Match Winner";
      const marketKey = isMatchWinner ? "h2h" : slugifyMarketName(bet.name);
      markets[marketKey] = {
        outcomes: bet.values.map((v) => ({
          name: isMatchWinner ? normalizeMatchWinnerOutcome(v.value, homeTeam, awayTeam) : v.value,
          price: Number(v.odd),
        })),
      };
    }
    bookmakerOdds[bookmakerKeyFor(rawBookmaker.name)] = { title: rawBookmaker.name, markets };
  }
  return bookmakerOdds;
}

export class ApiFootballError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "ApiFootballError";
  }
}

export interface ApiFootballClientOptions {
  apiKey: string;
  host?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ApiFootballClient {
  private readonly apiKey: string;
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private lastQuotaSnapshot: QuotaSnapshot | undefined;

  constructor(options: ApiFootballClientOptions) {
    if (!options.apiKey) {
      throw new Error("ApiFootballClient requires an apiKey");
    }
    this.apiKey = options.apiKey;
    this.host = options.host ?? DEFAULT_HOST;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getLastQuotaSnapshot(): QuotaSnapshot | undefined {
    return this.lastQuotaSnapshot;
  }

  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const MAX_ATTEMPTS = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.requestOnce<T>(path, params);
      } catch (err) {
        lastError = err;
        const isRetryable = err instanceof ApiFootballError && (err.status === 0 || err.status === 429 || err.status >= 500);
        if (!isRetryable || attempt === MAX_ATTEMPTS) throw err;
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }
    }
    throw lastError;
  }

  private async requestOnce<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(this.host + path);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        headers: { accept: "application/json", "x-apisports-key": this.apiKey },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ApiFootballError(`API-Football request timed out after ${this.timeoutMs}ms: ${path}`, 0, "");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    this.captureQuotaSnapshot(res.headers);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiFootballError(`API-Football request failed: ${res.status} ${path}`, res.status, body);
    }

    return (await res.json()) as T;
  }

  private captureQuotaSnapshot(headers: Headers): void {
    const remainingDay = headers.get("x-ratelimit-requests-remaining");
    const remainingMinute = headers.get("x-ratelimit-remaining");
    if (remainingDay === null && remainingMinute === null) return;
    this.lastQuotaSnapshot = {
      remainingDay: remainingDay !== null ? Number(remainingDay) : undefined,
      remainingMinute: remainingMinute !== null ? Number(remainingMinute) : undefined,
    };
  }

  /**
   * Fixture ids + team names for a given date, unfiltered by league. Confirmed live
   * (2026-09-07) this works for the current season even though league+season-scoped
   * queries are blocked on the Free plan (see CLAUDE.md's "API-Football odds quota"
   * section) — used as a fallback to resolve team names for a fixture id when the
   * /odds response itself doesn't carry them (it doesn't).
   */
  async getFixturesByDate(date: string): Promise<Map<string, RawFixtureTeams>> {
    const raw = await this.request<RawFixturesResponse>("/fixtures", { date });
    const byId = new Map<string, RawFixtureTeams>();
    for (const entry of raw.response) {
      byId.set(String(entry.fixture.id), entry.teams);
    }
    return byId;
  }

  /**
   * All fixtures with odds for one date, worldwide, unfiltered by league — deliberately
   * NOT using the `league`+`season` filter combination, since that's blocked for the
   * current season on the Free plan (confirmed live). Callers filter to their watched
   * leagues client-side (see apps/web/lib/ingest/api-football-league-map.ts's usage in
   * the ingest route). Paginated at 10 fixtures/page by the API; `maxPages` is a
   * defensive cap (the ingest route passes one) so a pathological day with far more
   * pages than usual can't blow the daily request budget in one run.
   */
  async getOddsByDate(date: string, maxPages: number): Promise<ApiFootballFixtureOdds[]> {
    const fixtures: ApiFootballFixtureOdds[] = [];
    let fixtureTeamsById: Map<string, RawFixtureTeams> | undefined;

    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= maxPages) {
      if (page > 1) await new Promise((resolve) => setTimeout(resolve, PAGE_FETCH_INTERVAL_MS));
      const raw = await this.request<RawOddsResponse>("/odds", { date, page });
      totalPages = raw.paging.total;

      for (const entry of raw.response) {
        const fixtureId = String(entry.fixture.id);
        if (!fixtureTeamsById) fixtureTeamsById = await this.getFixturesByDate(date);
        const teams = fixtureTeamsById.get(fixtureId);
        if (!teams) continue; // Shouldn't happen in practice; skip rather than guess team names.
        fixtures.push({
          fixtureId,
          leagueId: entry.league.id,
          commenceTime: entry.fixture.date,
          homeTeam: teams.home.name,
          awayTeam: teams.away.name,
          bookmakerOdds: normalizeBookmakers(entry.bookmakers, teams.home.name, teams.away.name),
        });
      }
      page++;
    }
    return fixtures;
  }
}

let cachedClient: ApiFootballClient | undefined;

/** Lazily builds a singleton client from API_FOOTBALL_API_KEY. Throws at call time, not import time. */
export function getApiFootballClient(): ApiFootballClient {
  if (!cachedClient) {
    const apiKey = process.env.API_FOOTBALL_API_KEY;
    if (!apiKey) {
      throw new Error(
        "API_FOOTBALL_API_KEY is not set. Get a free key from https://www.api-football.com and run `vercel env add API_FOOTBALL_API_KEY`.",
      );
    }
    const host = process.env.API_FOOTBALL_HOST || undefined;
    const timeoutMs = process.env.API_FOOTBALL_TIMEOUT_MS ? Number(process.env.API_FOOTBALL_TIMEOUT_MS) : undefined;
    cachedClient = new ApiFootballClient({ apiKey, host, timeoutMs });
  }
  return cachedClient;
}
