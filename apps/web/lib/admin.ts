import { currentUser } from "@clerk/nextjs/server";

/** True when a Clerk user's publicMetadata marks them as admin. */
export function isAdminRole(publicMetadata: unknown): boolean {
  return (
    typeof publicMetadata === "object" &&
    publicMetadata !== null &&
    (publicMetadata as { role?: string }).role === "admin"
  );
}

/** Server-side check for the currently authenticated user. */
export async function currentUserIsAdmin(): Promise<boolean> {
  const user = await currentUser();
  return isAdminRole(user?.publicMetadata);
}
