import type { BookmakerOdds } from "../types";

export interface OddsUpdateEvent {
  fixtureId: string;
  bookmakerOdds: BookmakerOdds;
  receivedAt: number;
}

/**
 * Swappable odds-ingestion strategy. RestPollingSource implements this today
 * (cron-driven, fits Vercel Functions' request-scoped model); a future
 * WebsocketIngestionSource can implement the same interface against
 * wss://api.oddspapi.io/v4/ws once B2B WebSocket access is confirmed with the
 * provider — the rest of the system (Redis cache shape, SSE fan-out) never changes.
 */
export interface OddsIngestionSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  onUpdate(handler: (event: OddsUpdateEvent) => void | Promise<void>): void;
}

export interface OddsCache {
  setFixtureOdds(fixtureId: string, odds: BookmakerOdds, ttlSeconds: number): Promise<void>;
  getFixtureOdds(fixtureId: string): Promise<BookmakerOdds | null>;
}
