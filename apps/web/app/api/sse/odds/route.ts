import { RedisOddsCache } from "@bet/odds-api-client";

const POLL_INTERVAL_MS = 4000;
const encoder = new TextEncoder();

export async function GET(req: Request) {
  const fixtureId = new URL(req.url).searchParams.get("fixtureId");
  if (!fixtureId) {
    return new Response("fixtureId query param is required", { status: 400 });
  }

  const cache = new RedisOddsCache();
  let lastSerialized: string | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const tick = async () => {
        if (closed) return;
        try {
          const odds = await cache.getFixtureOdds(fixtureId);
          const serialized = JSON.stringify(odds);
          if (serialized !== lastSerialized) {
            lastSerialized = serialized;
            send("odds", { fixtureId, bookmakerOdds: odds });
          } else {
            send("ping", { at: Date.now() });
          }
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : "unknown error" });
        }
      };

      await tick();
      const interval = setInterval(tick, POLL_INTERVAL_MS);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
