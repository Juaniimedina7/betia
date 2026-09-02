import { auth, currentUser } from "@clerk/nextjs/server";
import { createMCPClient } from "@ai-sdk/mcp";
import { createAgentUIStreamResponse } from "ai";
import { createParlayAgent } from "@/lib/agent/parlay-agent";
import { mintInternalMcpToken } from "@/lib/mcp/internal-token";
import { consumeRun } from "@/lib/usage";
import { isAdminRole } from "@/lib/admin";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;

  // Admins get unlimited combinadas — skip quota entirely. Everyone else is
  // metered before we spend an LLM call.
  if (!isAdminRole(user?.publicMetadata)) {
    const quota = await consumeRun(userId, email);
    if (!quota.allowed) {
      return Response.json(
        {
          error: "quota_exceeded",
          planId: quota.planId,
          used: quota.used,
          limit: quota.limit,
          message: "Te quedaste sin combinadas este mes. Pasate a un plan superior para seguir.",
        },
        { status: 402 },
      );
    }
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
