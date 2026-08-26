import { getOddsPapiClient, OddsPapiError, RedisOddsCache, RestPollingSource } from "@bet/oddspapi-client";

const ODDS_CACHE_TTL_SECONDS = 120;
const DEFAULT_BOOKMAKER = "pinnacle";

function watchedTournamentIds(): string[] {
  return (process.env.WATCHED_TOURNAMENT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const cache = new RedisOddsCache();
  const source = new RestPollingSource({
    client: getOddsPapiClient(),
    watchedTournamentIds,
    bookmaker: process.env.ODDSPAPI_BOOKMAKER || DEFAULT_BOOKMAKER,
  });

  source.onUpdate(async (event) => {
    await cache.setFixtureOdds(event.fixtureId, event.bookmakerOdds, ODDS_CACHE_TTL_SECONDS);
  });

  try {
    const result = await source.poll();
    return Response.json(result);
  } catch (err) {
    if (err instanceof OddsPapiError) {
      return Response.json(
        { error: err.message, status: err.status },
        { status: err.status === 0 ? 504 : 502 },
      );
    }
    throw err;
  }
}
