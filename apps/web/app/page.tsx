import { currentUser } from "@clerk/nextjs/server";
import { PublicLanding } from "@/components/public-landing";
import { UserDashboard, type DashboardUsage } from "@/components/user-dashboard";
import { getFeaturedEvents } from "@/lib/featured-events";
import { getUsage } from "@/lib/usage";

// Signed-in users get a personalised board, so this route can't be static.
export const dynamic = "force-dynamic";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default async function HomePage() {
  if (!clerkEnabled) return <PublicLanding />;

  const user = await currentUser();
  if (!user) return <PublicLanding />;

  const [{ events, error }, usage] = await Promise.all([
    getFeaturedEvents(),
    // The board still renders if Postgres is unreachable — the chips just hide.
    getUsage(user.id).catch(() => null),
  ]);

  return (
    <UserDashboard
      firstName={user.firstName}
      initialUsage={usage as DashboardUsage | null}
      events={events}
      eventsError={error}
    />
  );
}
