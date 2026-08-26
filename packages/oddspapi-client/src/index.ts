import type {
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

  listSports(): Promise<Sport[]> {
    return this.request<Sport[]>("/v4/sports");
  }

  listTournaments(sportId: string): Promise<Tournament[]> {
    return this.request<Tournament[]>("/v4/tournaments", { sportId });
  }

  listFixtures(params: ListFixturesParams = {}): Promise<Fixture[]> {
    return this.request<Fixture[]>("/v4/fixtures", { ...params });
  }

  getOdds(fixtureId: string): Promise<Fixture> {
    return this.request<Fixture>("/v4/odds", { fixtureId });
  }

  getOddsByTournaments(params: GetOddsByTournamentParams): Promise<Fixture[]> {
    return this.request<Fixture[]>("/v4/odds-by-tournaments", {
      tournamentIds: params.tournamentIds,
      bookmaker: params.bookmaker,
      oddsFormat: params.oddsFormat ?? "decimal",
    });
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
