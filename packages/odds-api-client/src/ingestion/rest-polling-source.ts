import type { OddsApiClient } from "../index";
import type { OddsIngestionSource, OddsUpdateEvent } from "./types";

export interface RestPollingSourceOptions {
  client: OddsApiClient;
  /** Sport keys to poll (e.g. "soccer_epl") — keep this bounded to stay within quota. */
  watchedSportKeys: () => Promise<string[]> | string[];
  /** Bookmakers to request. Unlike OddsPapi, one call returns every requested bookmaker's odds together. */
  bookmakers: string[];
  markets?: string[];
  includeLinks?: boolean;
}

/**
 * Cron-driven ingestion: Vercel Functions are request-scoped, so there is no
 * long-lived loop here. `/api/ingest/poll` calls `poll()` once per invocation.
 * start()/stop() exist only to satisfy OddsIngestionSource — no-ops for the REST strategy.
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

  async poll(): Promise<{ eventsPolled: number }> {
    const sportKeys = await this.options.watchedSportKeys();
    if (sportKeys.length === 0) {
      return { eventsPolled: 0 };
    }

    // GET /v4/sports/{sport}/odds returns fixtures AND every requested bookmaker's
    // odds together in one call — no per-bookmaker looping or 5-id batching needed
    // (both were OddsPapi-specific constraints of /v4/odds-by-tournaments).
    const events: Awaited<ReturnType<OddsApiClient["getSportOdds"]>> = [];
    for (const sportKey of sportKeys) {
      const sportEvents = await this.options.client.getSportOdds(sportKey, {
        bookmakers: this.options.bookmakers,
        markets: this.options.markets,
        includeLinks: this.options.includeLinks,
      });
      events.push(...sportEvents);
    }

    for (const event of events) {
      if (Object.keys(event.bookmakerOdds).length === 0) continue;
      const updateEvent: OddsUpdateEvent = {
        eventId: event.eventId,
        sportKey: event.sportKey,
        sportTitle: event.sportTitle,
        commenceTime: event.commenceTime,
        homeTeam: event.homeTeam,
        awayTeam: event.awayTeam,
        bookmakerOdds: event.bookmakerOdds,
        receivedAt: Date.now(),
      };
      for (const handler of this.handlers) {
        await handler(updateEvent);
      }
    }

    return { eventsPolled: events.length };
  }
}
