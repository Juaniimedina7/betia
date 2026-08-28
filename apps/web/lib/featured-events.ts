import { extractCandidateLegs, type CandidateLeg } from "@bet/combo-engine";
import { getOddsByTournament, listSports, listTournaments } from "@bet/mcp-tools";

/** Same default set as the ingestion cron — see `WATCHED_TOURNAMENT_IDS` in .env.example. */
const FALLBACK_TOURNAMENT_IDS = ["7", "679", "17", "8", "23", "35", "34", "384", "155"];

/** A fixture is treated as in-play from kickoff until this long after it. */
const LIVE_WINDOW_MS = 4 * 60 * 60 * 1000;

const MAX_EVENTS = 6;

export interface FeaturedPick {
  /** Short market label: "1" / "X" / "2" for a three-way, otherwise the raw selection index. */
  label: string;
  price: number;
  edgePct: number;
  /** Highest-edge selection of the fixture — rendered as the value price. */
  best: boolean;
}

export interface FeaturedEvent {
  fixtureId: string;
  sportId: string;
  sportName: string;
  tournamentId: string;
  tournamentName: string;
  participant1: string;
  participant2: string;
  startTime: string;
  live: boolean;
  /** Best edge across the fixture's selections, in percent. */
  edgePct: number;
  picks: FeaturedPick[];
}

/** "1 / X / 2" for a three-way market, "1 / 2" for a two-way, raw index otherwise. */
function pickLabel(playerIdx: string, playerCount: number): string {
  if (playerCount === 3) return { "1": "1", "2": "X", "3": "2" }[playerIdx] ?? playerIdx;
  if (playerCount === 2) return { "1": "1", "2": "2" }[playerIdx] ?? playerIdx;
  return playerIdx;
}

/**
 * Picks the fixture's headline market: the outcome group with two or three
 * selections (moneyline / 1X2 shape), preferring the lowest market id — the
 * main market in OddsPapi's numbering.
 */
function headlineGroup(legs: CandidateLeg[]): CandidateLeg[] | null {
  const groups = new Map<string, CandidateLeg[]>();
  for (const leg of legs) {
    const key = `${leg.marketId}::${leg.outcomeId}`;
    const group = groups.get(key);
    if (group) group.push(leg);
    else groups.set(key, [leg]);
  }

  const usable = [...groups.values()].filter((g) => g.length === 2 || g.length === 3);
  if (usable.length === 0) return null;

  return usable.sort((a, b) => {
    // Three-way markets first, then the lowest market id.
    if (a.length !== b.length) return b.length - a.length;
    return Number(a[0]!.marketId) - Number(b[0]!.marketId);
  })[0]!;
}

/**
 * Featured fixtures for the logged-in dashboard: the watched tournaments' odds
 * run through the same de-vig / edge math as the combo engine, ranked by the
 * best value on the board. Never throws — the dashboard renders an empty state.
 */
export async function getFeaturedEvents(): Promise<{ events: FeaturedEvent[]; error: string | null }> {
  const tournamentIds = (process.env.WATCHED_TOURNAMENT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  try {
    const { fixtures } = await getOddsByTournament({
      tournamentIds: tournamentIds.length > 0 ? tournamentIds : FALLBACK_TOURNAMENT_IDS,
    });

    const legsByFixture = new Map<string, CandidateLeg[]>();
    for (const leg of extractCandidateLegs(fixtures)) {
      const legs = legsByFixture.get(leg.fixtureId);
      if (legs) legs.push(leg);
      else legsByFixture.set(leg.fixtureId, [leg]);
    }

    const now = Date.now();
    const events: FeaturedEvent[] = [];

    for (const fixture of fixtures) {
      const group = headlineGroup(legsByFixture.get(fixture.fixtureId) ?? []);
      if (!group) continue;

      const bestEdge = Math.max(...group.map((leg) => leg.edgePct));
      const kickoff = new Date(fixture.startTime).getTime();

      events.push({
        fixtureId: fixture.fixtureId,
        sportId: fixture.sportId,
        sportName: fixture.sportId,
        tournamentId: fixture.tournamentId,
        tournamentName: `Torneo ${fixture.tournamentId}`,
        participant1: fixture.participant1Name ?? fixture.participant1Id,
        participant2: fixture.participant2Name ?? fixture.participant2Id,
        startTime: fixture.startTime,
        live: Number.isFinite(kickoff) && kickoff <= now && now - kickoff < LIVE_WINDOW_MS,
        edgePct: bestEdge,
        picks: group
          .slice()
          .sort((a, b) => Number(a.playerIdx) - Number(b.playerIdx))
          .map((leg) => ({
            label: pickLabel(leg.playerIdx, group.length),
            price: leg.priceDecimal,
            edgePct: leg.edgePct,
            best: leg.edgePct === bestEdge,
          })),
      });
    }

    events.sort((a, b) => b.edgePct - a.edgePct);
    const top = events.slice(0, MAX_EVENTS);

    await decorateNames(top);
    return { events: top, error: null };
  } catch (e) {
    return { events: [], error: e instanceof Error ? e.message : "No se pudieron cargar los partidos" };
  }
}

/** Resolves sport and tournament ids to display names. Best-effort: ids stay on failure. */
async function decorateNames(events: FeaturedEvent[]): Promise<void> {
  if (events.length === 0) return;

  try {
    const { sports } = await listSports({});
    const sportNames = new Map(sports.map((s) => [s.sportId, s.name]));

    const sportIds = [...new Set(events.map((e) => e.sportId))];
    const tournamentLists = await Promise.all(
      sportIds.map((sportId) => listTournaments({ sportId }).catch(() => ({ tournaments: [] }))),
    );
    const tournamentNames = new Map(
      tournamentLists.flatMap(({ tournaments }) => tournaments.map((t) => [t.tournamentId, t.name] as const)),
    );

    for (const event of events) {
      event.sportName = sportNames.get(event.sportId) ?? event.sportId;
      event.tournamentName = tournamentNames.get(event.tournamentId) ?? event.tournamentName;
    }
  } catch {
    // Names are cosmetic — the ids already render.
  }
}
