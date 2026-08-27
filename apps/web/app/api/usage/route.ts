import { auth, currentUser } from "@clerk/nextjs/server";
import { getUsage } from "@/lib/usage";
import { isAdminRole } from "@/lib/admin";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const user = await currentUser();
  if (isAdminRole(user?.publicMetadata)) {
    return Response.json({ admin: true, planId: "admin", used: 0, limit: 0, remaining: 0 });
  }

  const usage = await getUsage(userId);
  return Response.json({ ...usage, admin: false });
}
