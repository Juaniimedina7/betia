import type { OddsPapiClient } from "../index";
import type { OddsIngestionSource, OddsUpdateEvent } from "./types";

export interface RestPollingSourceOptions {
  client: OddsPapiClient;
  /** Tournament ids to poll — keep this bounded to stay within free-tier request quotas. */
  watchedTournamentIds: () => Promise<string[]> | string[];
  /**
   * `/v4/odds-by-tournaments` requires exactly one bookmaker per call — the API
   * rejects requests with none or more than one. Pick a book with broad market
   * coverage (e.g. "pinnacle") as the reference price.
   */
  bookmaker: string;
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

    const fixtures = await this.options.client.getOddsByTournaments({
      tournamentIds,
      bookmaker: this.options.bookmaker,
    });

    for (const fixture of fixtures) {
      if (!fixture.bookmakerOdds) continue;
      const event: OddsUpdateEvent = {
        fixtureId: fixture.fixtureId,
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
