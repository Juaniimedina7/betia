import type { BookmakerOdds } from "../types";

export interface OddsUpdateEvent {
  eventId: string;
  sportKey: string;
  sportTitle?: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakerOdds: BookmakerOdds;
  receivedAt: number;
}

/**
 * Swappable odds-ingestion strategy. RestPollingSource implements this today
 * (cron-driven, fits Vercel Functions' request-scoped model) — the rest of the
 * system (Redis cache shape, SSE fan-out) doesn't depend on how updates arrive.
 */
export interface OddsIngestionSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  onUpdate(handler: (event: OddsUpdateEvent) => void | Promise<void>): void;
}

export interface OddsCache {
  setFixtureOdds(eventId: string, odds: BookmakerOdds, ttlSeconds: number): Promise<void>;
  getFixtureOdds(eventId: string): Promise<BookmakerOdds | null>;
}
