import { auth } from "@clerk/nextjs/server";
import { createMCPClient } from "@ai-sdk/mcp";
import { createAgentUIStreamResponse } from "ai";
import { createParlayAgent } from "@/lib/agent/parlay-agent";
import { mintInternalMcpToken } from "@/lib/mcp/internal-token";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages } = await req.json();

  const internalToken = await mintInternalMcpToken(userId);
  const mcpUrl = new URL("/api/mcp", req.url);

  const mcpClient = await createMCPClient({
    transport: {
      type: "http",
      url: mcpUrl.toString(),
      headers: { Authorization: `Bearer ${internalToken}` },
    },
  });

  const tools = await mcpClient.tools();
  const agent = createParlayAgent(tools);

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
    onEnd: async () => {
      await mcpClient.close();
    },
  });
}
