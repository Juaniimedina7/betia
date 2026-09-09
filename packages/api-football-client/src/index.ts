import type {
  ApiFootballBookmakerOdds,
  ApiFootballFixtureOdds,
  ApiFootballFixtureResult,
  ApiFootballMarketQuote,
  QuotaSnapshot,
} from "./types";

export * from "./types";

const DEFAULT_HOST = "https://v3.football.api-sports.io";
const DEFAULT_TIMEOUT_MS = 10_000;
// Confirmed live 2026-09-07 against the Free plan: x-ratelimit-limit is 10/minute.
// Pacing requests at this interval keeps a run comfortably under that (~9.2/min)
// without needing a 429-triggered backoff for the common case — see CLAUDE.md's
// "API-Football odds quota" section for the full budget math this pacing is based on.
const REQUEST_INTERVAL_MS = 6_500;

// The raw response shapes below mirror what api-sports.io's /odds and /odds/bookmakers
// endpoints actually return (confirmed live, not from docs alone) — snake_case is
// mixed with API-Football's own camelCase-ish field names, which is why this
// normalization layer exists rather than trusting the raw shape everywhere else.
interface RawOddsValue {
  // Confirmed live 2026-09-08: normally a string, but some markets (e.g.
  // exact_goals_number, home_team_exact_goals_number) return this as a raw JSON
  // number instead (e.g. `0`, `1`, `2`) — coerced to string in normalizeBookmakers
  // below so every consumer can always treat outcome names as plain strings.
  value: string | number;
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
}

interface RawFixtureTeams {
  home: { name: string };
  away: { name: string };
}

interface RawFixtureEntry {
  fixture: { id: number; date: string };
  league: { id: number };
  teams: RawFixtureTeams;
}

interface RawFixturesResponse {
  response: RawFixtureEntry[];
  errors: unknown;
}

interface RawFixtureStatusEntry {
  fixture: { id: number; status: { short: string } };
  teams: RawFixtureTeams;
  goals: { home: number | null; away: number | null };
  score: { halftime: { home: number | null; away: number | null } };
}

interface RawFixtureStatusResponse {
  response: RawFixtureStatusEntry[];
  errors: unknown;
}

/** How many fixture ids `GET /fixtures?ids=` accepts in one call, per API-Football's own docs. */
const MAX_IDS_PER_FIXTURES_REQUEST = 20;

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
 * by grade-h2h-leg.ts (provider-agnostic since 2026-09-08, see MatchResult there),
 * since that only cares about the marketId string and the team-name outcome strings,
 * not which provider supplied them.
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
  allowedBookmakerNames: ReadonlySet<string> | undefined,
): ApiFootballBookmakerOdds {
  const bookmakerOdds: ApiFootballBookmakerOdds = {};
  for (const rawBookmaker of rawBookmakers) {
    if (allowedBookmakerNames && !allowedBookmakerNames.has(rawBookmaker.name.toLowerCase())) continue;
    const markets: Record<string, ApiFootballMarketQuote> = {};
    for (const bet of rawBookmaker.bets) {
      const isMatchWinner = bet.name === "Match Winner";
      const marketKey = isMatchWinner ? "h2h" : slugifyMarketName(bet.name);
      markets[marketKey] = {
        outcomes: bet.values.map((v) => ({
          name: isMatchWinner ? normalizeMatchWinnerOutcome(String(v.value), homeTeam, awayTeam) : String(v.value),
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
   * Odds for every fixture on a date that belongs to one of `leagueIds`, discovered via
   * `GET /fixtures?date=` (unfiltered — confirmed live 2026-09-07 this works for the
   * current season even though `league`+`season`-scoped queries are blocked on the
   * Free plan, see CLAUDE.md's "API-Football odds quota" section) and then one
   * `GET /odds?fixture=<id>` call per matching fixture.
   *
   * This deliberately does NOT use the bulk `GET /odds?date=` endpoint — confirmed
   * live 2026-09-08 that it silently excludes major competitions (UEFA Champions
   * League, Copa Libertadores, Copa Sudamericana all confirmed excluded) that a direct
   * `GET /odds?fixture=<id>` call for the exact same fixture *does* return odds for.
   * Filtering to our watched leagues before fetching odds — rather than fetching
   * everything and filtering after, the way the abandoned bulk approach did — is also
   * cheaper: most days only a handful of fixtures fall in `leagueIds` out of the
   * 250-350 worldwide, versus ~16 bulk pages/day regardless of relevance.
   *
   * A fixture with no bookmaker odds posted yet (`/odds?fixture=` returns an empty
   * `response`) is skipped, not treated as an error. `maxFixtures` is a defensive cap
   * (the ingest route passes one) so a pathological day (e.g. a Champions League
   * matchday with ~18 simultaneous kickoffs across our watched competitions) can't
   * blow the daily request budget in one run.
   *
   * `allowedBookmakerNames` (case-insensitive) restricts which of a fixture's
   * bookmakers actually get normalized/returned — without it, every bookmaker
   * API-Football has odds for on that fixture comes through (this API's own
   * `/odds/bookmakers` catalog has 33). The ingest route passes a curated allowlist
   * matching the team's bookmaker policy; this is the actual filter (unlike
   * apps/web/lib/bookmaker-links.ts, which only controls display name/link, not
   * whether a bookmaker's odds get stored at all).
   */
  async getOddsForLeagues(
    date: string,
    leagueIds: ReadonlySet<number>,
    maxFixtures: number,
    allowedBookmakerNames?: ReadonlySet<string>,
  ): Promise<ApiFootballFixtureOdds[]> {
    const fixturesRaw = await this.request<RawFixturesResponse>("/fixtures", { date });
    const relevant = fixturesRaw.response.filter((f) => leagueIds.has(f.league.id)).slice(0, maxFixtures);

    const fixtures: ApiFootballFixtureOdds[] = [];
    for (let i = 0; i < relevant.length; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
      const entry = relevant[i]!;
      const oddsRaw = await this.request<RawOddsResponse>("/odds", { fixture: entry.fixture.id });
      const oddsEntry = oddsRaw.response[0];
      if (!oddsEntry) continue; // No bookmaker has posted odds yet for this fixture.
      const bookmakerOdds = normalizeBookmakers(
        oddsEntry.bookmakers,
        entry.teams.home.name,
        entry.teams.away.name,
        allowedBookmakerNames,
      );
      if (Object.keys(bookmakerOdds).length === 0) continue; // None of this fixture's bookmakers are allowed.
      fixtures.push({
        fixtureId: String(entry.fixture.id),
        leagueId: entry.league.id,
        commenceTime: entry.fixture.date,
        homeTeam: entry.teams.home.name,
        awayTeam: entry.teams.away.name,
        bookmakerOdds,
      });
    }
    return fixtures;
  }

  /**
   * Match status + score for a batch of fixture ids, via `GET /fixtures?ids=1-2-3`
   * (id-based, so — like the other calls in this client — it isn't blocked by the
   * Free plan's current-season restriction on `league`+`season`-scoped endpoints).
   * Used by /api/ingest/settle to grade soccer bet_slip_legs, which is only possible
   * because settle now needs results for fixtures API-Football itself sourced (their
   * own numeric fixture ids, stored as the `apifootball:<id>` odds_cache eventId) —
   * see apps/web/app/api/ingest/settle/route.ts and CLAUDE.md's "eliminar The Odds
   * API de futbol" section.
   *
   * Batches at MAX_IDS_PER_FIXTURES_REQUEST ids/call (API-Football's own cap) and
   * paces batches at the same REQUEST_INTERVAL_MS as getOddsForLeagues to respect the
   * 10/minute rate limit. A fixture id API-Football doesn't recognize (wrong id,
   * postponed off its schedule, etc.) is simply absent from the result — callers
   * should treat a missing id as "leave pending", not an error.
   */
  async getFixtureResults(fixtureIds: string[]): Promise<ApiFootballFixtureResult[]> {
    const results: ApiFootballFixtureResult[] = [];
    for (let i = 0; i < fixtureIds.length; i += MAX_IDS_PER_FIXTURES_REQUEST) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
      const batch = fixtureIds.slice(i, i + MAX_IDS_PER_FIXTURES_REQUEST);
      const raw = await this.request<RawFixtureStatusResponse>("/fixtures", { ids: batch.join("-") });
      for (const entry of raw.response) {
        results.push({
          fixtureId: String(entry.fixture.id),
          statusShort: entry.fixture.status.short,
          homeTeam: entry.teams.home.name,
          awayTeam: entry.teams.away.name,
          homeGoals: entry.goals.home,
          awayGoals: entry.goals.away,
          homeGoalsHalftime: entry.score.halftime.home,
          awayGoalsHalftime: entry.score.halftime.away,
        });
      }
    }
    return results;
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
