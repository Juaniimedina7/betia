"use client";

import { UserButton } from "@clerk/nextjs";

/** Clerk's avatar menu plus our own account links. Client-only because
 *  UserButton's compound children (UserButton.Link) can't be used from RSC. */
export function UserMenu() {
  return (
    <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }}>
      <UserButton.MenuItems>
        <UserButton.Link label="Mi suscripción" labelIcon={<CardIcon />} href="/settings/suscripcion" />
        <UserButton.Link label="Tokens MCP" labelIcon={<KeyIcon />} href="/settings/tokens" />
      </UserButton.MenuItems>
    </UserButton>
  );
}

function CardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="8" cy="15" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M11 12l9-9M17 6l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
