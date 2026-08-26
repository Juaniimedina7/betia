import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-[var(--line)]">
      <div className="container-page flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-sm">
          <span className="font-display text-lg font-extrabold tracking-tight">
            BET<span style={{ color: "var(--color-edge)" }}>IA</span>
          </span>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
            Recomendaciones informativas basadas en cuotas en vivo. BETIA no coloca
            apuestas: vos apostás manualmente donde quieras. Jugá con responsabilidad.
          </p>
        </div>
        <div className="flex gap-8 text-sm text-[var(--color-ink-muted)]">
          <div className="flex flex-col gap-2">
            <Link href="/odds" className="hover:text-[var(--color-ink)]">Cuotas</Link>
            <Link href="/agent" className="hover:text-[var(--color-ink)]">Agente</Link>
            <Link href="/pricing" className="hover:text-[var(--color-ink)]">Precios</Link>
          </div>
          <div className="flex flex-col gap-2">
            <Link href="/bets" className="hover:text-[var(--color-ink)]">Mis apuestas</Link>
            <Link href="/settings/tokens" className="hover:text-[var(--color-ink)]">Tokens MCP</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
