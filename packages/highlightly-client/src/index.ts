import type {
  GetHeadToHeadParams,
  GetLeaguesParams,
  GetStandingsParams,
  HeadToHeadFixture,
  HighlightlyLeague,
  RawHeadToHeadFixture,
  RawLeaguesResponse,
  RawStandingsResponse,
  TeamSeasonStanding,
} from "./types";

export * from "./types";

const DEFAULT_HOST = "https://soccer.highlightly.net";
const DEFAULT_TIMEOUT_MS = 10_000;

function normalizeLeague(raw: RawLeaguesResponse["data"][number]): HighlightlyLeague {
  return {
    leagueId: String(raw.id),
    name: raw.name,
    countryName: raw.country.name,
    seasons: raw.seasons.map((s) => s.season),
  };
}

function normalizeStandings(raw: RawStandingsResponse, leagueId: string, season: string): TeamSeasonStanding[] {
  return raw.groups.flatMap((group) =>
    group.standings.map((row) => ({
      teamId: String(row.team.id),
      teamName: row.team.name,
      leagueId,
      season,
      home: {
        matchesPlayed: row.home.games,
        wins: row.home.wins,
        draws: row.home.draws,
        losses: row.home.loses,
        goalsFor: row.home.scoredGoals,
        goalsAgainst: row.home.receivedGoals,
      },
      away: {
        matchesPlayed: row.away.games,
        wins: row.away.wins,
        draws: row.away.draws,
        losses: row.away.loses,
        goalsFor: row.away.scoredGoals,
        goalsAgainst: row.away.receivedGoals,
      },
    })),
  );
}

/** "3 - 0" -> [3, 0]. Assumes home-away order (Highlightly doesn't label the pair explicitly). */
function parseScore(current: string | null): [number, number] | null {
  if (!current) return null;
  const match = current.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function normalizeHeadToHeadFixture(raw: RawHeadToHeadFixture): HeadToHeadFixture {
  const parsed = parseScore(raw.state.score.current);
  return {
    fixtureId: String(raw.id),
    date: raw.date,
    leagueId: String(raw.league.id),
    season: String(raw.league.season),
    homeTeamId: String(raw.homeTeam.id),
    awayTeamId: String(raw.awayTeam.id),
    homeGoals: parsed ? parsed[0] : null,
    awayGoals: parsed ? parsed[1] : null,
  };
}

export class HighlightlyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "HighlightlyError";
  }
}

export interface HighlightlyClientOptions {
  apiKey: string;
  host?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HighlightlyClient {
  private readonly apiKey: string;
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HighlightlyClientOptions) {
    if (!options.apiKey) {
      throw new Error("HighlightlyClient requires an apiKey");
    }
    this.apiKey = options.apiKey;
    this.host = options.host ?? DEFAULT_HOST;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const MAX_ATTEMPTS = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.requestOnce<T>(path, params);
      } catch (err) {
        lastError = err;
        // Same transient-failure policy as the other provider clients in this repo:
        // retry timeouts/429/5xx with a short linear backoff. Highlightly's BASIC plan
        // showed no per-minute throttling in testing (10 rapid calls all succeeded),
        // just the 100/day cap surfaced via x-ratelimit-requests-remaining — so unlike
        // ApiFootballClient this one doesn't need built-in inter-request pacing.
        const isRetryable =
          err instanceof HighlightlyError && (err.status === 0 || err.status === 429 || err.status >= 500);
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
        headers: { accept: "application/json", "x-rapidapi-key": this.apiKey },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new HighlightlyError(`Highlightly request timed out after ${this.timeoutMs}ms: ${path}`, 0, "");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new HighlightlyError(`Highlightly request failed: ${res.status} ${path}`, res.status, body);
    }

    return (await res.json()) as T;
  }

  async getLeagues(params: GetLeaguesParams = {}): Promise<{ leagues: HighlightlyLeague[]; totalCount: number }> {
    const raw = await this.request<RawLeaguesResponse>("/leagues", {
      limit: params.limit,
      offset: params.offset,
    });
    return { leagues: raw.data.map(normalizeLeague), totalCount: raw.pagination.totalCount };
  }

  async getStandings(params: GetStandingsParams): Promise<TeamSeasonStanding[]> {
    const raw = await this.request<RawStandingsResponse>("/standings", {
      leagueId: params.leagueId,
      season: params.season,
    });
    return normalizeStandings(raw, params.leagueId, params.season);
  }

  async getHeadToHead(params: GetHeadToHeadParams): Promise<HeadToHeadFixture[]> {
    const raw = await this.request<RawHeadToHeadFixture[]>("/head-2-head", {
      teamIdOne: params.team1Id,
      teamIdTwo: params.team2Id,
    });
    return raw.map(normalizeHeadToHeadFixture);
  }
}

let cachedClient: HighlightlyClient | undefined;

/** Lazily builds a singleton client from HIGHLIGHTLY_API_KEY. Throws at call time, not import time. */
export function getHighlightlyClient(): HighlightlyClient {
  if (!cachedClient) {
    const apiKey = process.env.HIGHLIGHTLY_API_KEY;
    if (!apiKey) {
      throw new Error(
        "HIGHLIGHTLY_API_KEY is not set. Get a free key from https://highlightly.net (Dashboard -> Sign up) and run `vercel env add HIGHLIGHTLY_API_KEY`.",
      );
    }
    const host = process.env.HIGHLIGHTLY_HOST || undefined;
    const timeoutMs = process.env.HIGHLIGHTLY_TIMEOUT_MS ? Number(process.env.HIGHLIGHTLY_TIMEOUT_MS) : undefined;
    cachedClient = new HighlightlyClient({ apiKey, host, timeoutMs });
  }
  return cachedClient;
}
