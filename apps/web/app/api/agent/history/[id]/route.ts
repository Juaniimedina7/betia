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

    // Map to the current AI SDK v5 UIMessage shape — `parts`, not the legacy v3/v4
    // `content`/`toolInvocations` top-level fields. A message missing `parts` fails
    // createAgentUIStreamResponse's `validateUIMessages` with a synchronous
    // AI_TypeValidationError as soon as the next message is sent (confirmed live
    // 2026-09-11: this is what turned "send a second message in any loaded
    // conversation" into a flat 500 with an empty body — Next.js swallows the
    // production stack trace, so the error banner gave no hint of the real cause).
    // Tool parts use the real `dynamic-tool` shape (`toolName`/`state`/`input`/
    // `output`) that isToolPart/getToolOutput in lib/agent-tool-output.ts already
    // expect from a live streaming response — using a different shape here would
    // silently break historical tool-result cards even once the crash was fixed.
    const uiMessages = messages.map((m) => {
      const parts: unknown[] = [];
      if (m.content) {
        parts.push({ type: "text", text: m.content });
      }

      const toolCalls = (m.toolCalls as any[]) ?? [];
      const toolResults = (m.toolResults as Record<string, any>) ?? {};
      for (const call of toolCalls) {
        parts.push({
          type: "dynamic-tool",
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          state: "output-available",
          input: call.args,
          output: toolResults[call.toolCallId] ?? null,
        });
      }

      return { id: m.id, role: m.role, parts };
    });

    return Response.json(uiMessages);
  } catch (error) {
    console.error("[agent/history] Error fetching chat messages", error);
    return Response.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}
