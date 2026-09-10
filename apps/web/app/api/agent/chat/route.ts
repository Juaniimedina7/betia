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

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey === "REPLACE_ME") {
    console.error("[agent/chat] ANTHROPIC_API_KEY is not configured in this environment.");
    return Response.json(
      { error: "configuration_error", message: "La funcionalidad del agente no está configurada (API Key faltante). Contactá al administrador." },
      { status: 500 }
    );
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
    // Agent-level step callback (distinct from the UI-message-stream `onEnd` below) —
    // fires once per LLM call with every tool call/result made during that step. This
    // is the only visibility we have into what the model actually decided to call and
    // with what arguments; without it, an "erratic" agent (wrong tool, wrong args,
    // tool erroring, or getting cut off by the `stopWhen: isStepCount(8)` cap in
    // parlay-agent.ts) is invisible until a user reports it.
    onStepEnd: (step) => {
      const tag = `[agent/chat] user=${userId} step=${step.stepNumber}`;
      for (const call of step.toolCalls) {
        console.log(`${tag} tool_call ${call.toolName}`, JSON.stringify(call.input));
      }
      for (const part of step.content) {
        if (part.type === "tool-result") {
          console.log(`${tag} tool_result ${part.toolName}`, JSON.stringify(part.output).slice(0, 2000));
        } else if (part.type === "tool-error") {
          console.error(`${tag} tool_error ${part.toolName}`, part.error);
        }
      }
      console.log(`${tag} finishReason=${step.finishReason}`);
    },
    onEnd: async () => {
      await mcpClient.close();
    },
    // Default is `() => "An error occurred."` — a mid-stream failure (Anthropic API
    // error, uncaught tool exception) would otherwise surface that fixed English
    // string as-is to the chat UI. Log the real error server-side and hand the client
    // a safe, distinguishable Spanish message instead.
    onError: (error) => {
      console.error("[agent/chat] stream error", error);
      return "No pudimos completar la respuesta del agente. Probá de nuevo en un momento.";
    },
  });
}
