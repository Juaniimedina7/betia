import { currentUser } from "@clerk/nextjs/server";
import { getUserBetProfile } from "@bet/db";
import { PublicLanding } from "@/components/public-landing";
import { UserDashboard, type DashboardUsage } from "@/components/user-dashboard";
import { isAdminRole } from "@/lib/admin";
import { getFeaturedEvents } from "@/lib/featured-events";
import { getUsage } from "@/lib/usage";

// Signed-in users get a personalised board, so this route can't be static.
export const dynamic = "force-dynamic";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!clerkEnabled) return <PublicLanding />;

  const user = await currentUser();
  if (!user) return <PublicLanding />;

  // Admins bypass the quota entirely — same shape /api/usage returns for them.
  const admin = isAdminRole(user.publicMetadata);

  const [{ events, error }, usage, betProfile] = await Promise.all([
    getFeaturedEvents(),
    admin
      ? Promise.resolve<DashboardUsage>({
          admin: true,
          planId: "admin",
          used: 0,
          limit: 0,
          remaining: 0,
        })
      : // The board still renders if Postgres is unreachable — the chips just hide.
        getUsage(user.id).catch(() => null),
    // Si Postgres no responde, el CTA del perfil simplemente no se muestra.
    getUserBetProfile(user.id).catch(() => undefined),
  ]);

  const params = await searchParams;
  const checkoutReturn =
    params.suscripcion === "ok"
      ? { preapprovalId: typeof params.preapproval_id === "string" ? params.preapproval_id : null }
      : null;

  return (
    <UserDashboard
      firstName={user.firstName}
      initialUsage={usage}
      events={events}
      eventsError={error}
      betProfile={betProfile}
      checkoutReturn={checkoutReturn}
    />
  );
}
