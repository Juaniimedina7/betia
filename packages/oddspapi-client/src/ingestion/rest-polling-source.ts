import type { OddsPapiClient } from "../index";
import type { OddsIngestionSource, OddsUpdateEvent } from "./types";

const MAX_TOURNAMENT_IDS_PER_REQUEST = 5;
// OddsPapi enforces a short per-request pacing window on /v4/odds-by-tournaments
// (observed ~60ms); with a watchlist this size, batches land close enough together
// to trip it, so space them out a bit.
const BATCH_DELAY_MS = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RestPollingSourceOptions {
  client: OddsPapiClient;
  /** Tournament ids to poll — keep this bounded to stay within free-tier request quotas. */
  watchedTournamentIds: () => Promise<string[]> | string[];
  /**
   * `/v4/odds-by-tournaments` requires exactly one bookmaker per call — the API
   * rejects requests with none or more than one, so multiple books means one full
   * pass over the watchlist per book. Include a broad-coverage reference (e.g.
   * "pinnacle") plus at least one more so downstream de-vig/edge math has a second
   * price to compare against — a single book can only ever show ~0% edge.
   */
  bookmakers: string[];
}

/**
 * Cron-driven ingestion: Vercel Functions are request-scoped, so there is no
 * long-lived loop here. `/api/ingest/poll` calls `poll()` once per invocation.
 * start()/stop() exist only so this satisfies OddsIngestionSource the same
 * shape a future WebsocketIngestionSource would — they are no-ops for the
 * REST strategy.
 */
export class RestPollingSource implements OddsIngestionSource {
  private handlers: Array<(event: OddsUpdateEvent) => void | Promise<void>> = [];

  constructor(private readonly options: RestPollingSourceOptions) {}

  async start(): Promise<void> {
    // no-op: polling happens on-demand via poll(), invoked by the cron route
  }

  async stop(): Promise<void> {
    // no-op
  }

  onUpdate(handler: (event: OddsUpdateEvent) => void | Promise<void>): void {
    this.handlers.push(handler);
  }

  async poll(): Promise<{ fixturesPolled: number }> {
    const tournamentIds = await this.options.watchedTournamentIds();
    if (tournamentIds.length === 0) {
      return { fixturesPolled: 0 };
    }

    // /v4/odds-by-tournaments rejects more than 5 tournamentIds per call, so
    // watchlists longer than that have to be polled in batches — once per bookmaker,
    // since the API also only accepts one bookmaker per call. Every batch (across
    // every bookmaker) shares one delay-spaced loop so the pacing window is respected
    // regardless of how many books are configured.
    const fixtures: Awaited<ReturnType<OddsPapiClient["getOddsByTournaments"]>> = [];
    let firstCall = true;
    for (const bookmaker of this.options.bookmakers) {
      for (let i = 0; i < tournamentIds.length; i += MAX_TOURNAMENT_IDS_PER_REQUEST) {
        if (!firstCall) await sleep(BATCH_DELAY_MS);
        firstCall = false;
        const batch = tournamentIds.slice(i, i + MAX_TOURNAMENT_IDS_PER_REQUEST);
        const batchFixtures = await this.options.client.getOddsByTournaments({
          tournamentIds: batch,
          bookmaker,
        });
        fixtures.push(...batchFixtures);
      }
    }

    for (const fixture of fixtures) {
      if (!fixture.bookmakerOdds) continue;
      const event: OddsUpdateEvent = {
        fixtureId: fixture.fixtureId,
        sportId: fixture.sportId,
        tournamentId: fixture.tournamentId,
        participant1Id: fixture.participant1Id,
        participant2Id: fixture.participant2Id,
        participant1Name: fixture.participant1Name,
        participant2Name: fixture.participant2Name,
        startTime: fixture.startTime,
        statusId: fixture.statusId,
        bookmakerOdds: fixture.bookmakerOdds,
        receivedAt: Date.now(),
      };
      for (const handler of this.handlers) {
        await handler(event);
      }
    }

    return { fixturesPolled: fixtures.length };
  }
}
