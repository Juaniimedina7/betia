import type {
  BookmakerOdds,
  Fixture,
  GetHistoricalOddsParams,
  GetOddsByTournamentParams,
  HistoricalOddsPoint,
  ListFixturesParams,
  Sport,
  Tournament,
} from "./types";

export * from "./types";
export * from "./ingestion/types";
export { RestPollingSource } from "./ingestion/rest-polling-source";
export { RedisOddsCache } from "./ingestion/redis-cache";

const DEFAULT_HOST = "https://api.oddspapi.io";

// The live API's field names/types differ from our internal Sport/Tournament/Fixture
// shapes (e.g. numeric ids, `sportName` instead of `name`). These Raw* types and
// normalize* functions are the single place that maps API reality onto our contract
// so the rest of the app never has to know about the raw shape.
interface RawSport {
  sportId: number;
  slug: string;
  sportName: string;
}

interface RawTournament {
  tournamentId: number;
  tournamentSlug: string;
  tournamentName: string;
  categorySlug?: string;
  categoryName?: string;
}

interface RawFixture {
  fixtureId: string;
  participant1Id: number | string;
  participant2Id: number | string;
  participant1Name?: string;
  participant2Name?: string;
  sportId: number | string;
  tournamentId: number | string;
  seasonId?: number | string;
  statusId?: number | string;
  startTime: string;
  hasOdds?: boolean;
  bookmakerOdds?: BookmakerOdds;
}

function normalizeSport(raw: RawSport): Sport {
  return { sportId: String(raw.sportId), name: raw.sportName };
}

function normalizeTournament(raw: RawTournament, sportId: string): Tournament {
  return {
    tournamentId: String(raw.tournamentId),
    sportId,
    name: raw.tournamentName,
    countryCode: raw.categorySlug,
  };
}

function normalizeFixture(raw: RawFixture): Fixture {
  return {
    fixtureId: raw.fixtureId,
    sportId: String(raw.sportId),
    tournamentId: String(raw.tournamentId),
    seasonId: raw.seasonId !== undefined ? String(raw.seasonId) : undefined,
    participant1Id: String(raw.participant1Id),
    participant2Id: String(raw.participant2Id),
    participant1Name: raw.participant1Name,
    participant2Name: raw.participant2Name,
    startTime: raw.startTime,
    statusId: raw.statusId !== undefined ? String(raw.statusId) : undefined,
    hasOdds: raw.hasOdds,
    bookmakerOdds: raw.bookmakerOdds,
  };
}

const isoNow = () => new Date().toISOString();
const isoDaysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

export class OddsPapiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "OddsPapiError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_FIXTURES_PER_LIST = 200;

export interface OddsPapiClientOptions {
  apiKey: string;
  host?: string;
  fetchImpl?: typeof fetch;
  /** Aborts a request that takes longer than this. Defaults to 10s. */
  timeoutMs?: number;
}

export class OddsPapiClient {
  private readonly apiKey: string;
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OddsPapiClientOptions) {
    if (!options.apiKey) {
      throw new Error("OddsPapiClient requires an apiKey");
    }
    this.apiKey = options.apiKey;
    this.host = options.host ?? DEFAULT_HOST;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number | string[] | undefined> = {},
  ): Promise<T> {
    const MAX_ATTEMPTS = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.requestOnce<T>(path, params);
      } catch (err) {
        lastError = err;
        // OddsPapi occasionally 500s on heavy payloads (e.g. /v4/odds with many
        // bookmakers), times out under load, or 429s under its tight per-request
        // pacing window — these are usually transient, so retry with a short
        // backoff. Other client errors (4xx) are not retried.
        const isRetryable =
          err instanceof OddsPapiError && (err.status === 0 || err.status === 429 || err.status >= 500);
        if (!isRetryable || attempt === MAX_ATTEMPTS) throw err;
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }
    }
    throw lastError;
  }

  private async requestOnce<T>(
    path: string,
    params: Record<string, string | number | string[] | undefined>,
  ): Promise<T> {
    const url = new URL(this.host + path);
    url.searchParams.set("apiKey", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new OddsPapiError(`OddsPapi request timed out after ${this.timeoutMs}ms: ${path}`, 0, "");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new OddsPapiError(`OddsPapi request failed: ${res.status} ${path}`, res.status, body);
    }

    return (await res.json()) as T;
  }

  async listSports(): Promise<Sport[]> {
    const raw = await this.request<RawSport[]>("/v4/sports");
    return raw.map(normalizeSport);
  }

  async listTournaments(sportId: string): Promise<Tournament[]> {
    const raw = await this.request<RawTournament[]>("/v4/tournaments", { sportId });
    return raw.map((t) => normalizeTournament(t, sportId));
  }

  async listFixtures(params: ListFixturesParams = {}): Promise<Fixture[]> {
    // The API requires `from`/`to` (max 10 days apart) whenever fixtures are
    // requested for a whole sport rather than a specific tournament/season.
    const needsDateWindow = !params.tournamentId && !params.from && !params.to;
    const resolvedParams = needsDateWindow
      ? { ...params, from: isoNow(), to: isoDaysFromNow(3) }
      : params;
    const raw = await this.request<RawFixture[]>("/v4/fixtures", { ...resolvedParams });
    // Browsing UIs only want fixtures a user could actually get odds for — a fixture
    // with hasOdds: false is just a dead end (empty odds board) if clicked into.
    const fixtures = raw.filter((f) => f.hasOdds !== false).map(normalizeFixture);
    fixtures.sort((a, b) => a.startTime.localeCompare(b.startTime));
    // A whole-sport query (e.g. worldwide soccer) can return thousands of fixtures
    // across every minor league — far more than any browsing UI should render or
    // than a single DB upsert batch should carry. Cap to the soonest matches.
    return needsDateWindow ? fixtures.slice(0, MAX_FIXTURES_PER_LIST) : fixtures;
  }

  async getOdds(fixtureId: string): Promise<Fixture> {
    const raw = await this.request<RawFixture>("/v4/odds", { fixtureId });
    return normalizeFixture(raw);
  }

  async getOddsByTournaments(params: GetOddsByTournamentParams): Promise<Fixture[]> {
    const raw = await this.request<RawFixture[]>("/v4/odds-by-tournaments", {
      tournamentIds: params.tournamentIds,
      bookmaker: params.bookmaker,
      oddsFormat: params.oddsFormat ?? "decimal",
    });
    return raw.map(normalizeFixture);
  }

  getHistoricalOdds(params: GetHistoricalOddsParams): Promise<HistoricalOddsPoint[]> {
    return this.request<HistoricalOddsPoint[]>("/v4/historical-odds", { ...params });
  }

  getScores(fixtureId: string): Promise<unknown> {
    return this.request("/v4/scores", { fixtureId });
  }

  getSettlements(fixtureId: string): Promise<unknown> {
    return this.request("/v4/settlements", { fixtureId });
  }
}

let cachedClient: OddsPapiClient | undefined;

/** Lazily builds a singleton client from ODDSPAPI_API_KEY. Throws at call time, not import time. */
export function getOddsPapiClient(): OddsPapiClient {
  if (!cachedClient) {
    const apiKey = process.env.ODDSPAPI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ODDSPAPI_API_KEY is not set. Get a key from https://oddspapi.io and run `vercel env add ODDSPAPI_API_KEY`.",
      );
    }
    const host = process.env.ODDSPAPI_HOST || undefined;
    const timeoutMs = process.env.ODDSPAPI_TIMEOUT_MS
      ? Number(process.env.ODDSPAPI_TIMEOUT_MS)
      : undefined;
    cachedClient = new OddsPapiClient({ apiKey, host, timeoutMs });
  }
  return cachedClient;
}
