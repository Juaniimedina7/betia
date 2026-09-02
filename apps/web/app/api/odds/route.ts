import { NextResponse } from "next/server";
import { estimateMatchProbability } from "@bet/mcp-tools";
import { getDb, oddsCache } from "@bet/db";
import type { BookmakerOdds } from "@bet/odds-api-client";
import { and, eq, isNotNull } from "drizzle-orm";

export const revalidate = 60;

/**
 * Pure DB read of odds_cache — no live call. This used to hit OddsPapi directly on
 * every request (the public landing page fetches this client-side on every anonymous
 * visit — was the single biggest quota risk in the app); now it never touches the
 * odds API at all, only /api/ingest/poll does.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Query param kept as "tournamentId" for URL/caller compatibility — it's actually
    // a sport_key (e.g. "soccer_epl") under the new provider.
    const sportKey = searchParams.get("tournamentId") || undefined;
    const teamSearch = searchParams.get("team")?.toLowerCase();
    const limit = parseInt(searchParams.get("limit") || "10", 10);

    const db = getDb();
    const conditions = [isNotNull(oddsCache.bookmakerOdds)];
    if (sportKey) conditions.push(eq(oddsCache.sportKey, sportKey));

    const rows = await db
      .select()
      .from(oddsCache)
      .where(and(...conditions))
      .orderBy(oddsCache.commenceTime);

    const filtered = teamSearch
      ? rows.filter(
          (r) => r.homeTeam?.toLowerCase().includes(teamSearch) || r.awayTeam?.toLowerCase().includes(teamSearch),
        )
      : rows;

    const matches = await Promise.all(
      filtered.slice(0, limit).map(async (row) => {
        // DB-only (never a live Highlightly call, see CLAUDE.md's "Highlightly quota"
        // section). Best-effort: statisticalProbability stays null if there isn't
        // enough ingested history yet.
        const statisticalProbability = await estimateMatchProbability({
          homeTeam: row.homeTeam ?? "",
          awayTeam: row.awayTeam ?? "",
          sportKey: row.sportKey,
        })
          .then((r) => (r.available ? r.statisticalProbability : null))
          .catch(() => null);

        return {
          fixtureId: row.eventId,
          participant1Name: row.homeTeam,
          participant2Name: row.awayTeam,
          startTime: (row.commenceTime ?? row.updatedAt).toISOString(),
          bookmakerOdds: row.bookmakerOdds as BookmakerOdds,
          statisticalProbability,
        };
      }),
    );

    return NextResponse.json({ success: true, data: matches });
  } catch (error) {
    console.error("Error in /api/odds:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch odds data" }, { status: 500 });
  }
}
