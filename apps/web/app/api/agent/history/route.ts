import { auth } from "@clerk/nextjs/server";
import { getDb, chatSessions } from "@bet/db";
import { eq, desc } from "drizzle-orm";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const db = getDb();
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.createdAt));

    return Response.json(sessions);
  } catch (error) {
    console.error("[agent/history] Error fetching chat sessions", error);
    return Response.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}
