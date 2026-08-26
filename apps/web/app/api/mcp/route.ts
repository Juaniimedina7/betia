import { createMcpHandler, withMcpAuth } from "mcp-handler";
import {
  buildComboInput,
  buildComboTool,
  getBestPrice,
  getBestPriceInput,
  getHistoricalOdds,
  getHistoricalOddsInput,
  getOdds,
  getOddsByTournament,
  getOddsByTournamentInput,
  getOddsInput,
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
      { description: "List all sports covered by OddsPapi.", inputSchema: listSportsInput },
      async (input) => jsonContent(await listSports(input)),
    );

    server.registerTool(
      "list_tournaments",
      { description: "List tournaments for a given sport.", inputSchema: listTournamentsInput },
      async (input) => jsonContent(await listTournaments(input)),
    );

    server.registerTool(
      "list_fixtures",
      { description: "List upcoming/live fixtures, optionally filtered.", inputSchema: listFixturesInput },
      async (input) => jsonContent(await listFixtures(input)),
    );

    server.registerTool(
      "get_odds",
      { description: "Get current odds for one fixture (cached if available).", inputSchema: getOddsInput },
      async (input) => jsonContent(await getOdds(input)),
    );

    server.registerTool(
      "get_odds_by_tournament",
      {
        description: "Get fixtures with odds for one or more tournaments.",
        inputSchema: getOddsByTournamentInput,
      },
      async (input) => jsonContent(await getOddsByTournament(input)),
    );

    server.registerTool(
      "get_best_price",
      {
        description: "Get the best available price for a specific market/outcome, with a fair-price/edge estimate.",
        inputSchema: getBestPriceInput,
      },
      async (input) => jsonContent(await getBestPrice(input)),
    );

    server.registerTool(
      "build_combo",
      {
        description:
          "Deterministically build a parlay/combo hitting a target multiplier or leg count from live odds, ranked by edge, never combining two legs from the same fixture.",
        inputSchema: buildComboInput,
      },
      async (input) => jsonContent(await buildComboTool(input)),
    );

    server.registerTool(
      "get_historical_odds",
      { description: "Get free historical odds for a fixture/market.", inputSchema: getHistoricalOddsInput },
      async (input) => jsonContent(await getHistoricalOdds(input)),
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
