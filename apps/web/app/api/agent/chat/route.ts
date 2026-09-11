import { auth, currentUser } from "@clerk/nextjs/server";
import { createMCPClient } from "@ai-sdk/mcp";
import { createAgentUIStreamResponse } from "ai";
import { createParlayAgent } from "@/lib/agent/parlay-agent";
import { mintInternalMcpToken } from "@/lib/mcp/internal-token";
import { consumeRun } from "@/lib/usage";
import { isAdminRole } from "@/lib/admin";
import { getDb, chatSessions, chatMessages } from "@bet/db";

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
  const url = new URL(req.url);
  const chatId = url.searchParams.get("chatId");
  
  const db = getDb();
  let sessionId = chatId;

  if (!sessionId) {
    const [newSession] = await db.insert(chatSessions).values({
      userId,
      title: "Nueva conversación"
    }).returning({ id: chatSessions.id });
    sessionId = newSession.id;
  }

  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === "user") {
    await db.insert(chatMessages).values({
      sessionId,
      role: "user",
      content: lastMsg.content
    });
  }

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

  let assistantContent = "";
  const toolCalls: any[] = [];
  const toolResults: Record<string, any> = {};

  const response = await createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
    onStepEnd: (step) => {
      const tag = `[agent/chat] user=${userId} step=${step.stepNumber}`;
      for (const call of step.toolCalls) {
        console.log(`${tag} tool_call ${call.toolName}`, JSON.stringify(call.input));
      }
      for (const part of step.content) {
        if (part.type === "text") {
          assistantContent += part.text;
        } else if (part.type === "tool-call") {
          // AI SDK types use `input` for the arguments payload
          toolCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName, args: (part as any).input || (part as any).args });
        } else if (part.type === "tool-result") {
          toolResults[part.toolCallId] = part.output;
          console.log(`${tag} tool_result ${part.toolName}`, JSON.stringify(part.output).slice(0, 2000));
        } else if (part.type === "tool-error") {
          console.error(`${tag} tool_error ${part.toolName}`, part.error);
        }
      }
      console.log(`${tag} finishReason=${step.finishReason}`);
    },
    onEnd: async () => {
      await mcpClient.close();
      if (assistantContent || toolCalls.length > 0) {
        await db.insert(chatMessages).values({
          sessionId,
          role: "assistant",
          content: assistantContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : null,
          toolResults: Object.keys(toolResults).length > 0 ? toolResults : null
        });
      }
    },
    onError: (error) => {
      console.error("[agent/chat] stream error", error);
      return "No pudimos completar la respuesta del agente. Probá de nuevo en un momento.";
    },
  });

  response.headers.set("x-chat-id", sessionId!);
  return response;
}
