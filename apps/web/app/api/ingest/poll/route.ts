import { getDb, oddsCache, sportsCache } from "@bet/db";
import { getOddsPapiClient, OddsPapiError, RedisOddsCache, RestPollingSource } from "@bet/oddspapi-client";
import { sql } from "drizzle-orm";

const ODDS_CACHE_TTL_SECONDS = 120;
const DEFAULT_BOOKMAKER = "pinnacle";

/**
 * Top-flight soccer leagues across Europe and Latin America, plus the main
 * continental cups. Hardcoded (rather than driven by WATCHED_TOURNAMENT_IDS) so the
 * cron works without any per-environment config — verified against a live
 * GET /v4/tournaments?sportId=10 pull, ids stable per the OddsPapi catalog.
 */
const DEFAULT_WATCHED_TOURNAMENT_IDS = [
  // Europe — top flights
  17, // England: Premier League
  8, // Spain: LaLiga
  23, // Italy: Serie A
  35, // Germany: Bundesliga
  34, // France: Ligue 1
  238, // Portugal: Liga Portugal
  37, // Netherlands: Eredivisie
  38, // Belgium: Pro League
  36, // Scotland: Premiership
  215, // Switzerland: Super League
  45, // Austria: Bundesliga
  185, // Greece: Super League
  202, // Poland: Ekstraklasa
  172, // Czechia: 1. Liga
  39, // Denmark: Superliga
  40, // Sweden: Allsvenskan
  20, // Norway: Eliteserien
  170, // Croatia: HNL
  210, // Serbia: Superliga
  218, // Ukraine: Premier League
  203, // Russia: Premier League
  152, // Romania: Superliga
  // Europe — continental cups
  7, // UEFA Champions League
  679, // UEFA Europa League
  34480, // UEFA Conference League
  // South America — continental cups
  384, // Copa Libertadores
  480, // Copa Sudamericana
  133, // Copa America
  // Latin America — top flights
  155, // Argentina: Liga Profesional
  325, // Brazil: Brasileiro Serie A
  27665, // Chile: Primera Division
  278, // Uruguay: Primera Division
  27098, // Paraguay: Division de Honor
  27070, // Colombia: Primera A
  406, // Peru: Liga 1
  240, // Ecuador: LigaPro Primera A
  33980, // Bolivia: Division Profesional
  231, // Venezuela: Primera Division
  27464, // Mexico: Liga MX
  27092, // Costa Rica: Primera Division
  27414, // Honduras: Liga Nacional
  27396, // Guatemala: Liga Nacional
  27102, // Panama: Liga Panamena de Futbol
].map(String);

function watchedTournamentIds(): string[] {
  const fromEnv = (process.env.WATCHED_TOURNAMENT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_WATCHED_TOURNAMENT_IDS;
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const client = getOddsPapiClient();
  const cache = new RedisOddsCache();
  const source = new RestPollingSource({
    client,
    watchedTournamentIds,
    bookmaker: process.env.ODDSPAPI_BOOKMAKER || DEFAULT_BOOKMAKER,
  });

  const db = getDb();
  source.onUpdate(async (event) => {
    // Independent, best-effort writes: Redis being unreachable/unconfigured
    // shouldn't stop the durable Postgres backup from getting this fixture's odds,
    // and vice versa.
    await Promise.allSettled([
      cache.setFixtureOdds(event.fixtureId, event.bookmakerOdds, ODDS_CACHE_TTL_SECONDS),
      db
        .insert(oddsCache)
        .values({ fixtureId: event.fixtureId, sportId: "", bookmakerOdds: event.bookmakerOdds })
        .onConflictDoUpdate({
          target: oddsCache.fixtureId,
          set: { bookmakerOdds: sql`excluded.bookmaker_odds`, updatedAt: sql`now()` },
        }),
    ]);
  });

  // Poll independently from the sports-list refresh: a failure in one (e.g. OddsPapi
  // 500s on /v4/sports) shouldn't discard fixture odds the other already fetched and
  // cached via the onUpdate side effect above.
  const [pollOutcome, sportsOutcome] = await Promise.allSettled([source.poll(), client.listSports()]);

  let sportsPolled = 0;
  if (sportsOutcome.status === "fulfilled" && sportsOutcome.value.length > 0) {
    const sports = sportsOutcome.value;
    await db
      .insert(sportsCache)
      .values(sports.map((s) => ({ sportId: s.sportId, name: s.name })))
      .onConflictDoUpdate({
        target: sportsCache.sportId,
        set: { name: sql`excluded.name`, updatedAt: sql`now()` },
      });
    sportsPolled = sports.length;
  }

  const errors: Record<string, { message: string; status: number; body?: string }> = {};
  for (const [key, outcome] of [
    ["fixtures", pollOutcome],
    ["sports", sportsOutcome],
  ] as const) {
    if (outcome.status === "rejected") {
      const err = outcome.reason;
      errors[key] =
        err instanceof OddsPapiError
          ? { message: err.message, status: err.status, body: err.body.slice(0, 500) }
          : { message: String(err), status: 0 };
    }
  }

  const fixturesPolled = pollOutcome.status === "fulfilled" ? pollOutcome.value.fixturesPolled : 0;
  const hasErrors = Object.keys(errors).length > 0;
  const allFailed = pollOutcome.status === "rejected" && sportsOutcome.status === "rejected";

  return Response.json(
    { fixturesPolled, sportsPolled, ...(hasErrors && { errors }) },
    { status: allFailed ? 502 : 200 },
  );
}
