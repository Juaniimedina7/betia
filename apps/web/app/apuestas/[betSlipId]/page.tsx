import { revalidatePath } from "next/cache";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { getUserBetSlip, updateBetSlipOutcome } from "@bet/mcp-tools";
import { notFound } from "next/navigation";
import { ComboTicket } from "@/components/combo-ticket";
import { resolveBookmakerLink, bookmakerDisplayName } from "@/lib/bookmaker-links";

export default async function BetSlipPage({ params }: PageProps<"/apuestas/[betSlipId]">) {
  const { betSlipId } = await params;
  const { userId } = await auth();
  const { betSlip, legs } = await getUserBetSlip({ betSlipId }, { userId: userId! });

  if (!betSlip) notFound();

  async function markOutcome(formData: FormData) {
    "use server";
    const { userId } = await auth();
    const outcome = formData.get("outcome") as "won" | "lost" | "void";
    await updateBetSlipOutcome({ betSlipId, userMarkedOutcome: outcome }, { userId: userId! });
    revalidatePath(`/apuestas/${betSlipId}`);
  }

  // Resolve bookmaker links for every leg (deep link → fallback homepage)
  const bookmakerLinks = (() => {
    const byBookmaker = new Map<string, { bookmaker: string; displayName: string; link: string }>();
    for (const leg of legs) {
      const bk = leg.bookmaker;
      const link = resolveBookmakerLink(leg.deepLink, bk);
      if (!link || byBookmaker.has(bk)) continue;
      byBookmaker.set(bk, { bookmaker: bk, displayName: bookmakerDisplayName(bk), link });
    }
    return [...byBookmaker.values()];
  })();

  return (
    <div className="container-page max-w-2xl py-14">
      <Link href="/apuestas" className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]">
        ← Mis apuestas
      </Link>

      <h1
        className="mt-3 font-display font-extrabold leading-tight"
        style={{ fontSize: "clamp(1.6rem, 3vw, 2.2rem)", letterSpacing: "-0.03em" }}
      >
        {betSlip.title ?? "Combinada"}
      </h1>

      <div className="mt-6">
        <ComboTicket
          legs={legs.map((leg) => ({
            selection: leg.selectionLabel,
            detail: leg.bookmaker,
            price: Number(leg.priceDecimal),
            edgePct: leg.edgePct != null ? Number(leg.edgePct) : undefined,
            deepLink: leg.deepLink ?? undefined,
          }))}
          multiplier={Number(betSlip.combinedOddsDecimal)}
          label={`Estado: ${betSlip.status}`}
          note={betSlip.reasoning ?? undefined}
        />

        {/* Bookmaker links — always shown using deep link or fallback homepage */}
        {bookmakerLinks.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="eyebrow">Ir a apostar</p>
            <div className="flex flex-wrap gap-2">
              {bookmakerLinks.map((entry) => (
                <a
                  key={entry.bookmaker}
                  href={entry.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-edge)]/30 bg-[var(--color-edge)]/10 px-3 py-2 text-sm font-medium text-[var(--color-edge)] transition-colors hover:bg-[var(--color-edge)]/20"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  Ir a {entry.displayName}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-8">
        {betSlip.userMarkedOutcome ? (
          <p className="text-sm text-[var(--color-ink-muted)]">
            Resultado marcado:{" "}
            <span className="font-medium text-[var(--color-ink)]">{betSlip.userMarkedOutcome}</span>
          </p>
        ) : (
          <>
            <p className="eyebrow mb-3">¿Cómo salió?</p>
            <form action={markOutcome} className="flex gap-2">
              <button name="outcome" value="won" className="btn btn-primary flex-1">Gané</button>
              <button
                name="outcome"
                value="lost"
                className="btn flex-1"
                style={{ background: "rgba(255,92,108,0.14)", color: "var(--color-danger)", border: "1px solid rgba(255,92,108,0.35)" }}
              >
                Perdí
              </button>
              <button name="outcome" value="void" className="btn btn-ghost flex-1">Anulada</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
