import Link from "next/link";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

const LINKS = [
  { href: "/odds", label: "Cuotas" },
  { href: "/agent", label: "Agente" },
  { href: "/pricing", label: "Precios" },
  { href: "/bets", label: "Mis apuestas" },
];

export function NavBar({ clerkEnabled }: { clerkEnabled: boolean }) {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[rgba(7,11,17,0.72)] backdrop-blur-xl">
      <nav className="container-page flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-7">
          <Link href="/" className="group flex items-center gap-2.5">
            <Wordmark />
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:bg-white/5 hover:text-[var(--color-ink)]"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="hidden items-center gap-2 text-xs text-[var(--color-ink-muted)] sm:flex">
            <span className="live-dot" />
            En vivo
          </span>

          {clerkEnabled ? (
            <>
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <button className="btn btn-ghost !px-3.5 !py-2 !text-sm">Ingresar</button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="btn btn-primary !px-3.5 !py-2 !text-sm">Crear cuenta</button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <Link href="/agent" className="btn btn-primary !px-3.5 !py-2 !text-sm">
                  Armar combo
                </Link>
                <UserButton
                  appearance={{ elements: { avatarBox: "h-8 w-8" } }}
                />
              </Show>
            </>
          ) : (
            <Link href="/agent" className="btn btn-primary !px-3.5 !py-2 !text-sm">
              Probar el agente
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}

function Wordmark() {
  return (
    <span
      className="font-display text-xl font-extrabold tracking-tight"
      style={{ letterSpacing: "0.01em" }}
    >
      BET
      <span
        style={{ color: "var(--color-edge)" }}
        className="transition-[text-shadow] group-hover:[text-shadow:0_0_18px_rgba(184,255,53,0.7)]"
      >
        IA
      </span>
    </span>
  );
}
