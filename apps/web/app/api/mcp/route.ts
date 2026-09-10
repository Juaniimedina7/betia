import { createMcpHandler, withMcpAuth } from "mcp-handler";
import {
  buildComboInput,
  buildComboTool,
  estimateMatchProbability,
  estimateMatchProbabilityInput,
  findPlayerProps,
  findPlayerPropsInput,
  getBestPrice,
  getBestPriceInput,
  getHeadToHead,
  getHeadToHeadInput,
  getOdds,
  getOddsByTournament,
  getOddsByTournamentInput,
  getOddsInput,
  toCuratedOddsOutput,
  getTeamStats,
  getTeamStatsInput,
  getUserBetSlip,
  getUserBetSlipInput,
  listFixtures,
  listFixturesInput,
  listSports,
  listSportsInput,
  listTournaments,
  listTournamentsInput,
  listUserBetSlips,
  listUserBetSlipsInput,
  saveBetSlip,
  saveBetSlipInput,
  updateBetSlipOutcome,
  updateBetSlipOutcomeInput,
  type ToolAuthContext,
} from "@bet/mcp-tools";
import { verifyMcpToken } from "@/lib/mcp/auth";

interface ToolCtx {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
}

function authContext(ctx: ToolCtx): ToolAuthContext | undefined {
  const userId = ctx.http?.authInfo?.extra?.userId;
  return typeof userId === "string" ? { userId } : undefined;
}

function jsonContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_sports",
      { description: "List all sport groups covered by the product.", inputSchema: listSportsInput },
      async (input) => jsonContent(await listSports(input)),
    );

    server.registerTool(
      "list_tournaments",
      {
        description:
          "List tournaments for a given sport. Each tournament includes `fixtureCount`, the real number of upcoming (not yet started) cached fixtures for it — a tournament can appear here with fixtureCount 0 if nothing is cached for it right now.",
        inputSchema: listTournamentsInput,
      },
      async (input) => jsonContent(await listTournaments(input)),
    );

    server.registerTool(
      "list_fixtures",
      {
        description:
          "List upcoming fixtures, optionally filtered by tournament, a from/to kickoff window, and/or `teamName` (fuzzy match against either team, independent of tournament — use this to find a specific match by team name(s) without first resolving its sport/competition). Already-started/finished fixtures are always excluded. Response includes `count`, the number of fixtures returned.",
        inputSchema: listFixturesInput,
      },
      async (input) => jsonContent(await listFixtures(input)),
    );

    server.registerTool(
      "get_odds",
      { description: "Get current odds for one fixture (cached if available). Response's `matchup.hasStarted` is true if the fixture's kickoff has already passed — the odds may be stale/no longer bettable in that case, say so rather than presenting them as live.", inputSchema: getOddsInput },
      // Trimmed to markets with a curated Spanish label — see toCuratedOddsOutput's
      // doc comment. Full, untrimmed data (every market) is only on the
      // /fixtures/[fixtureId] page, not exposed to the model here.
      async (input) => jsonContent(toCuratedOddsOutput(await getOdds(input))),
    );

    server.registerTool(
      "get_odds_by_tournament",
      {
        description: "Get fixtures with odds for one or more tournaments. Already-started fixtures are always excluded.",
        inputSchema: getOddsByTournamentInput,
      },
      async (input) => jsonContent(await getOddsByTournament(input)),
    );

    server.registerTool(
      "get_best_price",
      {
        description:
          "Get the best available price for a specific market/outcome, with a fair-price/edge estimate. Response's `hasStarted` is true if the fixture's kickoff has already passed.",
        inputSchema: getBestPriceInput,
      },
      async (input) => jsonContent(await getBestPrice(input)),
    );

    server.registerTool(
      "build_combo",
      {
        description:
          "Deterministically build a parlay/combo hitting a target multiplier or leg count from cached odds, ranked by real statistical (Poisson) win probability where available and market edge otherwise, never combining two legs from the same fixture. Every leg in the returned combo always comes from a single bookmaker so the user can actually place the real bet there. Without `bookmaker`, every cached bookmaker is tried and the best resulting combo is kept; pass `bookmaker` to force a specific one instead. Already-started fixtures are always excluded, even if they'd otherwise fall inside a given `from`/`to` window. Without `from`/`to` it considers every cached UPCOMING fixture regardless of kickoff date — pass them (ISO 8601 UTC) to scope to a specific day/window. `riskProfile` controls how risky the selected legs are — each profile pairs an edge floor with its OWN probability floor ('conservative' = high edge AND >=80% real chance of hitting, low-variance; 'balanced' = default edge floor AND >=25% real chance; 'aggressive' = loosest edge floor AND >=5% real chance) — see its own description for exact thresholds. Omitting `riskProfile` does NOT disable the probability floor: it falls back to 'conservative''s 80% specifically, so a bare call with no risk preference already only considers >=80%-probability legs — use `minProbability` to pick a different floor directly, or `0` to disable it (e.g. a high target multiplier that needs long-shot legs). Pass `fixtureId` instead of `sports`/`sportKeys` to build a same-match combo (multiple markets from ONE fixture, e.g. hándicap + más/menos + ambos anotan) — in that mode the result always carries a `disclaimer` about same-match correlation that must be relayed to the user verbatim, and a fixture that already started returns an empty result explaining why instead of attempting to build one.",
        inputSchema: buildComboInput,
      },
      async (input) => jsonContent(await buildComboTool(input)),
    );

    server.registerTool(
      "find_player_props",
      {
        description:
          "Search cached odds across fixtures for a specific player's prop markets (goalscorer, shots, assists, etc.) by fuzzy name match — tolerates case/accent differences since player names come through raw from the odds provider. `sportKeys` is optional (unlike build_combo/get_odds_by_tournament) since a player name is already a strong filter; pass `marketId` to narrow to one specific prop type. Returns the best price per fixture/market/outcome across cached bookmakers. Already-started fixtures are always excluded.",
        inputSchema: findPlayerPropsInput,
      },
      async (input) => jsonContent(await findPlayerProps(input)),
    );

    server.registerTool(
      "get_team_stats",
      {
        description:
          "Get a team's current-season stats (goals for/against, wins/draws/losses, home/away splits). This is statistical data, NOT market odds — never confuse it with build_combo's fair price.",
        inputSchema: getTeamStatsInput,
      },
      async (input) => jsonContent(await getTeamStats(input)),
    );

    server.registerTool(
      "get_head_to_head",
      {
        description:
          "Get the historical head-to-head record between two teams (wins/draws/losses). Statistical data, NOT market odds.",
        inputSchema: getHeadToHeadInput,
      },
      async (input) => jsonContent(await getHeadToHead(input)),
    );

    server.registerTool(
      "estimate_match_probability",
      {
        description:
          "Estimate win/draw/loss probability from historical goals (Poisson model) — this is the STATISTICAL probability, NOT the market-implied probability from build_combo/get_best_price. May return available:false if there isn't enough ingested history yet.",
        inputSchema: estimateMatchProbabilityInput,
      },
      async (input) => jsonContent(await estimateMatchProbability(input)),
    );

    server.registerTool(
      "save_bet_slip",
      {
        description: "Save a bet slip (combo recommendation) to the authenticated user's history.",
        inputSchema: saveBetSlipInput,
      },
      async (input, ctx: ToolCtx) => jsonContent(await saveBetSlip(input, authContext(ctx))),
    );

    server.registerTool(
      "list_user_bet_slips",
      {
        description: "List the authenticated user's saved bet slips.",
        inputSchema: listUserBetSlipsInput,
      },
      async (input, ctx: ToolCtx) => jsonContent(await listUserBetSlips(input, authContext(ctx))),
    );

    server.registerTool(
      "get_user_bet_slip",
      {
        description: "Get one of the authenticated user's saved bet slips, with its legs.",
        inputSchema: getUserBetSlipInput,
      },
      async (input, ctx: ToolCtx) => jsonContent(await getUserBetSlip(input, authContext(ctx))),
    );

    server.registerTool(
      "update_bet_slip_outcome",
      {
        description: "Mark a saved bet slip's outcome (won/lost/void) as reported by the user.",
        inputSchema: updateBetSlipOutcomeInput,
      },
      async (input, ctx: ToolCtx) => jsonContent(await updateBetSlipOutcome(input, authContext(ctx))),
    );
  },
  { serverInfo: { name: "bet-project-mcp", version: "0.1.0" } },
);

const authHandler = withMcpAuth(handler, verifyMcpToken, {
  required: false,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
