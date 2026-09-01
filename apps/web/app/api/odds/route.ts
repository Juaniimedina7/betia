import { NextResponse } from "next/server";
import { estimateMatchProbability } from "@bet/mcp-tools";
import { getOddsPapiClient, ListFixturesParams } from "@bet/oddspapi-client";

export const revalidate = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tournamentId = searchParams.get("tournamentId") || undefined;
    const teamSearch = searchParams.get("team")?.toLowerCase();
    const limit = parseInt(searchParams.get("limit") || "10", 10);

    const client = getOddsPapiClient();
    
    // Si no se pasa tournamentId, buscará partidos globales (la librería internamente limita a 200)
    const params: ListFixturesParams = {};
    if (tournamentId) {
      params.tournamentId = tournamentId;
    }

    let fixtures: any[] = [];
    let attempts = 0;
    while (attempts < 3) {
      try {
        fixtures = await client.listFixtures(params);
        break; // Éxito
      } catch (err: any) {
        if (err.status === 429) {
          attempts++;
          await new Promise(r => setTimeout(r, 1000)); // Esperar 1 segundo antes de reintentar
        } else {
          throw err;
        }
      }
    }

    if (fixtures.length === 0 && attempts >= 3) {
      throw new Error("Rate limit exceeded for listFixtures after retries");
    }
    
    // Filtrar por equipo si se envía el parámetro "team"
    let filteredMatches = fixtures;
    if (teamSearch) {
      filteredMatches = fixtures.filter(
        (f) =>
          f.participant1Name?.toLowerCase().includes(teamSearch) ||
          f.participant2Name?.toLowerCase().includes(teamSearch)
      );
    }

    // Tomar el límite establecido
    const nextMatches = filteredMatches.slice(0, limit);

    // Obtener las cuotas de forma secuencial para no superar el rate limit (1 req/sec) de la capa gratuita
    const matchesWithOdds = [];
    for (const match of nextMatches) {
      // DB-only (never a live Highlightly call, see CLAUDE.md's "Highlightly quota"
      // section) — safe to run alongside the OddsPapi rate-limit pacing above without
      // burning any extra external-API budget. Best-effort: statisticalProbability
      // stays null (not shown) if there isn't enough ingested history yet.
      const statisticalProbability = await estimateMatchProbability({
        participant1Id: match.participant1Id,
        participant2Id: match.participant2Id,
        tournamentId: match.tournamentId,
      })
        .then((r) => (r.available ? r.statisticalProbability : null))
        .catch(() => null);

      try {
        const detailedMatch = await client.getOdds(match.fixtureId);
        // Mezclamos para no perder los nombres de los equipos, ya que /odds a veces no los trae
        matchesWithOdds.push({
          ...detailedMatch,
          participant1Name: match.participant1Name || detailedMatch.participant1Name,
          participant2Name: match.participant2Name || detailedMatch.participant2Name,
          statisticalProbability,
        });
        // Pequeño delay de 250ms para ayudar a evitar el rate limit 429
        await new Promise(r => setTimeout(r, 250));
      } catch (e) {
        console.error(`Error fetching odds for match ${match.fixtureId}:`, e);
        matchesWithOdds.push({ ...match, statisticalProbability });
      }
    }

    return NextResponse.json({ success: true, data: matchesWithOdds });
  } catch (error) {
    console.error("Error in /api/odds:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch odds data" },
      { status: 500 }
    );
  }
}
