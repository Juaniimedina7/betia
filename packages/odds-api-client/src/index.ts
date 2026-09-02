import type {
  BookmakerOdds,
  BookmakerQuote,
  Event,
  GetSportOddsParams,
  MarketQuote,
  QuotaSnapshot,
  Sport,
} from "./types";

export * from "./types";
export * from "./ingestion/types";
export { RestPollingSource } from "./ingestion/rest-polling-source";
export { RedisOddsCache } from "./ingestion/redis-cache";

const DEFAULT_HOST = "https://api.the-odds-api.com";

// The live API's field names are snake_case and its bookmakers/markets come back as
// arrays, not dicts keyed by their own `key` — these Raw* types and normalize*
// functions are the single place that maps API reality onto our contract so the
// rest of the app never has to know about the raw shape.
interface RawSport {
  key: string;
  group: string;
  title: string;
  description?: string;
  active?: boolean;
  has_outrights?: boolean;
}

interface RawOutcome {
  name: string;
  price: number;
  point?: number;
}

interface RawMarket {
  key: string;
  last_update?: string;
  outcomes: RawOutcome[];
}

interface RawBookmaker {
  key: string;
  title: string;
  last_update?: string;
  markets: RawMarket[];
}

interface RawEvent {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: RawBookmaker[];
}

function normalizeSport(raw: RawSport): Sport {
  return {
    sportKey: raw.key,
    group: raw.group,
    title: raw.title,
    description: raw.description,
    active: raw.active,
    hasOutrights: raw.has_outrights,
  };
}

function normalizeBookmakerOdds(rawBookmakers: RawBookmaker[] | undefined): BookmakerOdds {
  const bookmakerOdds: BookmakerOdds = {};
  for (const rawBookmaker of rawBookmakers ?? []) {
    const markets: Record<string, MarketQuote> = {};
    for (const rawMarket of rawBookmaker.markets) {
      markets[rawMarket.key] = {
        lastUpdate: rawMarket.last_update,
        outcomes: rawMarket.outcomes.map((o) => ({ name: o.name, price: o.price, point: o.point })),
      };
    }
    const quote: BookmakerQuote = { title: rawBookmaker.title, lastUpdate: rawBookmaker.last_update, markets };
    bookmakerOdds[rawBookmaker.key] = quote;
  }
  return bookmakerOdds;
}

function normalizeEvent(raw: RawEvent): Event {
  return {
    eventId: raw.id,
    sportKey: raw.sport_key,
    sportTitle: raw.sport_title,
    commenceTime: raw.commence_time,
    homeTeam: raw.home_team,
    awayTeam: raw.away_team,
    bookmakerOdds: normalizeBookmakerOdds(raw.bookmakers),
  };
}

export class OddsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "OddsApiError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

export interface OddsApiClientOptions {
  apiKey: string;
  host?: string;
  fetchImpl?: typeof fetch;
  /** Aborts a request that takes longer than this. Defaults to 10s. */
  timeoutMs?: number;
}

export class OddsApiClient {
  private readonly apiKey: string;
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private lastQuotaSnapshot: QuotaSnapshot | undefined;

  constructor(options: OddsApiClientOptions) {
    if (!options.apiKey) {
      throw new Error("OddsApiClient requires an apiKey");
    }
    this.apiKey = options.apiKey;
    this.host = options.host ?? DEFAULT_HOST;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Quota usage from the most recent response's x-requests-* headers, if any. */
  getLastQuotaSnapshot(): QuotaSnapshot | undefined {
    return this.lastQuotaSnapshot;
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
        const isRetryable =
          err instanceof OddsApiError && (err.status === 0 || err.status === 429 || err.status >= 500);
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
        throw new OddsApiError(`The Odds API request timed out after ${this.timeoutMs}ms: ${path}`, 0, "");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    this.captureQuotaSnapshot(res.headers);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new OddsApiError(`The Odds API request failed: ${res.status} ${path}`, res.status, body);
    }

    return (await res.json()) as T;
  }

  private captureQuotaSnapshot(headers: Headers): void {
    const remaining = headers.get("x-requests-remaining");
    const used = headers.get("x-requests-used");
    const last = headers.get("x-requests-last");
    if (remaining === null && used === null && last === null) return;
    this.lastQuotaSnapshot = {
      remaining: remaining !== null ? Number(remaining) : undefined,
      used: used !== null ? Number(used) : undefined,
      last: last !== null ? Number(last) : undefined,
    };
  }

  async listSports(): Promise<Sport[]> {
    const raw = await this.request<RawSport[]>("/v4/sports");
    return raw.map(normalizeSport);
  }

  /** Lightweight fixture listing with no odds — cheap way to check a sport's coverage. */
  async listEvents(sportKey: string): Promise<Event[]> {
    const raw = await this.request<RawEvent[]>(`/v4/sports/${sportKey}/events`);
    return raw.map(normalizeEvent);
  }

  /**
   * The main odds endpoint: one call returns every upcoming event for this sport_key
   * AND all requested bookmakers' odds together — unlike OddsPapi, there's no
   * separate fixtures/odds split and no per-bookmaker call constraint.
   */
  async getSportOdds(sportKey: string, params: Omit<GetSportOddsParams, "sportKey">): Promise<Event[]> {
    const raw = await this.request<RawEvent[]>(`/v4/sports/${sportKey}/odds`, {
      bookmakers: params.bookmakers,
      markets: params.markets ?? ["h2h"],
      oddsFormat: params.oddsFormat ?? "decimal",
      dateFormat: params.dateFormat ?? "iso",
    });
    return raw.map(normalizeEvent);
  }
}

let cachedClient: OddsApiClient | undefined;

/** Lazily builds a singleton client from ODDSAPI_API_KEY. Throws at call time, not import time. */
export function getOddsApiClient(): OddsApiClient {
  if (!cachedClient) {
    const apiKey = process.env.ODDSAPI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ODDSAPI_API_KEY is not set. Get a key from https://the-odds-api.com and run `vercel env add ODDSAPI_API_KEY`.",
      );
    }
    const host = process.env.ODDSAPI_HOST || undefined;
    const timeoutMs = process.env.ODDSAPI_TIMEOUT_MS ? Number(process.env.ODDSAPI_TIMEOUT_MS) : undefined;
    cachedClient = new OddsApiClient({ apiKey, host, timeoutMs });
  }
  return cachedClient;
}
