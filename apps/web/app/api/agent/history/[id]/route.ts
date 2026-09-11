import { auth } from "@clerk/nextjs/server";
import { getDb, chatSessions, chatMessages } from "@bet/db";
import { eq, and, asc } from "drizzle-orm";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return new Response("Missing session id", { status: 400 });
  }

  try {
    const db = getDb();
    
    // Verify session belongs to user
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, userId)))
      .limit(1);
      
    if (!session) {
      return new Response("Not found or unauthorized", { status: 404 });
    }

    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, id))
      .orderBy(asc(chatMessages.createdAt));

    // Map to Vercel AI SDK format
    const uiMessages = messages.map((m) => {
      const parts = [];
      if (m.content) {
        parts.push({ type: "text", text: m.content });
      }
      
      const toolCalls = m.toolCalls as any[];
      if (toolCalls && toolCalls.length > 0) {
        toolCalls.forEach(call => {
           parts.push({
             type: "tool-invocation",
             toolInvocation: {
               state: "result", // To show historical tool calls, we consider them already resolved
               toolCallId: call.toolCallId,
               toolName: call.toolName,
               args: call.args,
               result: null // Results are typically merged or kept in a separate message/part, but we'll adapt based on the SDK's exact needs
             }
           });
        });
      }

      return {
        id: m.id,
        role: m.role,
        content: m.content || "",
        toolInvocations: toolCalls ? toolCalls.map(c => ({
          state: "result",
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          args: c.args,
          // Since BetIA parses tool results differently, we might just put the result here
          result: m.toolResults && (m.toolResults as Record<string, any>)[c.toolCallId]
        })) : undefined
      };
    });

    return Response.json(uiMessages);
  } catch (error) {
    console.error("[agent/history] Error fetching chat messages", error);
    return Response.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}
