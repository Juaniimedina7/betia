import { auth } from "@clerk/nextjs/server";
import { getUsage } from "@/lib/usage";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const usage = await getUsage(userId);
  return Response.json(usage);
}
