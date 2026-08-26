import { getOddsPapiClient, RedisOddsCache, RestPollingSource } from "@bet/oddspapi-client";

const ODDS_CACHE_TTL_SECONDS = 120;

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
  });

  source.onUpdate(async (event) => {
    await cache.setFixtureOdds(event.fixtureId, event.bookmakerOdds, ODDS_CACHE_TTL_SECONDS);
  });

  const result = await source.poll();
  return Response.json(result);
}
