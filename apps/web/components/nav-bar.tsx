import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";

export function NavBar() {
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold">
            bet-project
          </Link>
          <Link href="/odds" className="text-sm text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white">
            Odds
          </Link>
          <Link href="/agent" className="text-sm text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white">
            Agente
          </Link>
          <Link href="/bets" className="text-sm text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white">
            Mis apuestas
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <Show when="signed-out">
            <SignInButton mode="modal" />
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </nav>
    </header>
  );
}
