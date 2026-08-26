import { revalidatePath } from "next/cache";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { getUserBetSlip, updateBetSlipOutcome } from "@bet/mcp-tools";
import { notFound } from "next/navigation";
import { ComboTicket } from "@/components/combo-ticket";

export default async function BetSlipPage({ params }: PageProps<"/bets/[betSlipId]">) {
  const { betSlipId } = await params;
  const { userId } = await auth();
  const { betSlip, legs } = await getUserBetSlip({ betSlipId }, { userId: userId! });

  if (!betSlip) notFound();

  async function markOutcome(formData: FormData) {
    "use server";
    const { userId } = await auth();
    const outcome = formData.get("outcome") as "won" | "lost" | "void";
    await updateBetSlipOutcome({ betSlipId, userMarkedOutcome: outcome }, { userId: userId! });
    revalidatePath(`/bets/${betSlipId}`);
  }

  return (
    <div className="container-page max-w-2xl py-14">
      <Link href="/bets" className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]">
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
          }))}
          multiplier={Number(betSlip.combinedOddsDecimal)}
          label={`Estado: ${betSlip.status}`}
          note={betSlip.reasoning ?? undefined}
        />
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
