import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/agent(.*)",
  "/bets(.*)",
  "/settings(.*)",
  "/admin(.*)",
  "/api/agent(.*)",
]);

// Without Clerk configured, clerkMiddleware() throws on every request. Fall back
// to a pass-through so public pages (home, odds, fixtures) stay reachable.
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const clerk = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export default clerkEnabled ? clerk : () => NextResponse.next();

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
