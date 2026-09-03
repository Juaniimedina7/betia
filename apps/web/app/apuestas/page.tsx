import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { listUserBetSlips } from "@bet/mcp-tools";
import { Reveal } from "@/components/reveal";
import { betSlipStatusLabel } from "@/lib/bet-slip-status";

export default async function BetsPage() {
  let userId: string | null = null;
  try {
    ({ userId } = await auth());
  } catch {
    userId = null;
  }

  if (!userId) {
    return (
      <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-14 text-center">
        <h1 className="font-display text-2xl font-extrabold">Iniciá sesión para ver tus apuestas</h1>
        <p className="mt-2 max-w-sm text-sm text-[var(--color-ink-muted)]">
          Guardá las combinadas que arma el agente y seguí sus resultados desde acá.
        </p>
        <Link href="/agent" className="btn btn-primary mt-6">Ir al agente</Link>
      </div>
    );
  }

  const { betSlips } = await listUserBetSlips({}, { userId });

  return (
    <div className="container-page max-w-3xl py-14">
      <Reveal>
        <h1
          className="font-display font-extrabold leading-tight"
          style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", letterSpacing: "-0.03em" }}
        >
          Mis apuestas
        </h1>
      </Reveal>

      {betSlips.length === 0 ? (
        <div className="card mt-8 p-8 text-center">
          <p className="text-[var(--color-ink-muted)]">
            Todavía no guardaste ninguna combinada. Pedile una al{" "}
            <Link href="/agent" className="text-[var(--color-edge)] hover:underline">agente</Link>.
          </p>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-3">
          {betSlips.map((slip, i) => {
            const status = betSlipStatusLabel(slip.status);
            return (
              <Reveal key={slip.id} delay={Math.min(i * 40, 400)}>
                <Link href={`/apuestas/${slip.id}`} className="card card-hover flex items-center justify-between gap-4 px-5 py-4">
                  <div>
                    <p className="font-medium">{slip.title ?? "Combinada"}</p>
                    <p className="mt-0.5 text-xs" style={{ color: status.tone }}>{status.label}</p>
                  </div>
                  <span className="tnum font-display text-xl font-black" style={{ color: "var(--color-gold)" }}>
                    {Number(slip.combinedOddsDecimal).toFixed(2)}x
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      )}
    </div>
  );
}
