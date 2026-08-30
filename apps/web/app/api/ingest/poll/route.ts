import { getDb, oddsCache } from "@bet/db";
import { getOddsPapiClient, OddsPapiError, RedisOddsCache, RestPollingSource } from "@bet/oddspapi-client";
import { sql } from "drizzle-orm";

const ODDS_CACHE_TTL_SECONDS = 120;
const DEFAULT_BOOKMAKER = "pinnacle";

/**
 * Top-flight soccer leagues across Europe and Latin America, plus the main
 * continental cups. Hardcoded (rather than driven by WATCHED_TOURNAMENT_IDS) so the
 * cron works without any per-environment config — verified against a live
 * GET /v4/tournaments?sportId=10 pull, ids stable per the OddsPapi catalog.
 *
 * Kept to 20 (4 batches of 5 — RestPollingSource caps at
 * MAX_TOURNAMENT_IDS_PER_REQUEST per call) so two cron runs/day stay inside
 * OddsPapi's 250-request/month quota. Trimmed from a 44-league list that blew
 * way past that budget; smaller domestic leagues (e.g. Scotland, Nordic/Eastern
 * Europe, most of Central America) are cut — see git history if any of those
 * need to come back.
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
  27070, // Colombia: Primera A
  27464, // Mexico: Liga MX
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

  // The sports list is near-static reference data, refreshed for free whenever
  // a live UI request hits listSports() — not worth spending a monthly-quota
  // request on it here every run.
  try {
    const { fixturesPolled } = await source.poll();
    return Response.json({ fixturesPolled });
  } catch (err) {
    const error =
      err instanceof OddsPapiError
        ? { message: err.message, status: err.status, body: err.body.slice(0, 500) }
        : { message: String(err), status: 0 };
    return Response.json({ fixturesPolled: 0, errors: { fixtures: error } }, { status: 502 });
  }
}
