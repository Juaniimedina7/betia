import { getDb, oddsCache } from "@bet/db";
import type { Event } from "@bet/odds-api-client";
import { extractCandidateLegs } from "@bet/combo-engine";
import { and, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { resolveByName } from "../fuzzy-match";
import { marketLabel } from "../market-labels";

export const findPlayerPropsInput = z.object({
  playerName: z.string(),
  // Deliberately optional (unlike build_combo, which requires sportKeys/sports):
  // player-prop markets only exist on soccer fixtures ingested via API-Football, and a
  // player name is already a meaningful filter on its own — no "sweeps the whole
  // catalog" risk the way an unscoped build_combo call would have.
  sportKeys: z.array(z.string()).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  // Narrow to one market key (e.g. "home_player_shots") if the user asked for a
  // specific prop type; omit to search every market for this player name.
  marketId: z.string().optional(),
});

export type FindPlayerPropsInput = z.infer<typeof findPlayerPropsInput>;

export interface PlayerPropMatch {
  fixtureId: string;
  sportKey: string;
  homeTeam?: string;
  awayTeam?: string;
  startTime: string;
  marketId: string;
  marketLabel: string;
  outcomeName: string;
  point?: number;
  bestPrice: number;
  bookmaker: string;
}

/**
 * Scans cached fixtures for outcomes whose name fuzzy-matches `playerName` — player-prop
 * outcome names (e.g. "Lamine Yamal") come through raw and unnormalized from
 * API-Football (see packages/api-football-client's normalizeBookmakers, which only
 * translates "Match Winner" outcomes to real team names; everything else, including
 * every player-prop market, passes the provider's own string straight through).
 *
 * DB-only, no live call — matches candidate rows by sportKey/date the same way
 * build-combo.ts's readCachedEvents does, then scans each event's outcomes in JS via
 * extractCandidateLegs, same as every other odds-reading tool in this package. There's
 * no GIN index on odds_cache.bookmaker_odds to push a name search down to Postgres —
 * fine at the current handful-of-cached-fixtures scale, but revisit if this table
 * grows much larger (see CLAUDE.md's API-Football section for the jsonb-query
 * precedent, or the lack of one).
 */
export async function findPlayerProps(input: FindPlayerPropsInput): Promise<{ matches: PlayerPropMatch[] }> {
  let events: Event[];
  try {
    const db = getDb();
    const conditions = [isNotNull(oddsCache.bookmakerOdds)];
    if (input.sportKeys && input.sportKeys.length > 0) {
      conditions.push(inArray(oddsCache.sportKey, input.sportKeys));
    }
    if (input.from) conditions.push(gte(oddsCache.commenceTime, new Date(input.from)));
    if (input.to) conditions.push(lte(oddsCache.commenceTime, new Date(input.to)));

    const rows = await db
      .select()
      .from(oddsCache)
      .where(and(...conditions));
    events = rows.map((r) => ({
      eventId: r.eventId,
      sportKey: r.sportKey,
      sportTitle: r.sportTitle ?? undefined,
      commenceTime: (r.commenceTime ?? r.updatedAt).toISOString(),
      homeTeam: r.homeTeam ?? "",
      awayTeam: r.awayTeam ?? "",
      bookmakerOdds: (r.bookmakerOdds as Event["bookmakerOdds"]) ?? {},
    }));
  } catch {
    return { matches: [] };
  }

  const allLegs = extractCandidateLegs(events).filter((leg) => !input.marketId || leg.marketId === input.marketId);
  const outcomeNames = [...new Set(allLegs.map((leg) => leg.outcomeName))];
  const resolvedName = resolveByName(input.playerName, outcomeNames);
  if (!resolvedName) return { matches: [] };

  // extractCandidateLegs returns one leg per bookmaker for a given outcome — keep only
  // the best price per (fixture, market, outcome, point).
  const byKey = new Map<string, PlayerPropMatch>();
  for (const leg of allLegs) {
    if (leg.outcomeName !== resolvedName) continue;
    const key = `${leg.fixtureId}|${leg.marketId}|${leg.outcomeName}|${leg.point ?? ""}`;
    const existing = byKey.get(key);
    if (existing && existing.bestPrice >= leg.priceDecimal) continue;
    byKey.set(key, {
      fixtureId: leg.fixtureId,
      sportKey: leg.sportKey,
      homeTeam: leg.homeTeam,
      awayTeam: leg.awayTeam,
      startTime: leg.startTime,
      marketId: leg.marketId,
      marketLabel: marketLabel(leg.marketId),
      outcomeName: leg.outcomeName,
      point: leg.point,
      bestPrice: leg.priceDecimal,
      bookmaker: leg.bookmaker,
    });
  }

  return { matches: [...byKey.values()].sort((a, b) => a.startTime.localeCompare(b.startTime)) };
}
