import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { getUserBetSlip, updateBetSlipOutcome } from "@bet/mcp-tools";
import { notFound } from "next/navigation";

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
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">{betSlip.title ?? "Combo"}</h1>
      <p className="mb-6 text-sm text-gray-500">
        Cuota combinada <span className="font-mono">{betSlip.combinedOddsDecimal}x</span> · Estado: {betSlip.status}
      </p>

      {betSlip.reasoning && (
        <p className="mb-6 rounded border border-black/10 p-4 text-sm dark:border-white/10">{betSlip.reasoning}</p>
      )}

      <ul className="mb-6 divide-y divide-black/10 dark:divide-white/10">
        {legs.map((leg) => (
          <li key={leg.id} className="py-3 text-sm">
            <p className="font-medium">{leg.selectionLabel}</p>
            <p className="text-gray-500">
              {leg.bookmaker} · {leg.priceDecimal}x
              {leg.edgePct ? ` · edge ${Number(leg.edgePct).toFixed(1)}%` : ""}
            </p>
          </li>
        ))}
      </ul>

      {betSlip.userMarkedOutcome ? (
        <p className="text-sm text-gray-500">Resultado marcado: {betSlip.userMarkedOutcome}</p>
      ) : (
        <form action={markOutcome} className="flex gap-2">
          <button name="outcome" value="won" className="rounded bg-green-600 px-3 py-1.5 text-sm text-white">
            Gané
          </button>
          <button name="outcome" value="lost" className="rounded bg-red-600 px-3 py-1.5 text-sm text-white">
            Perdí
          </button>
          <button name="outcome" value="void" className="rounded bg-gray-500 px-3 py-1.5 text-sm text-white">
            Anulada
          </button>
        </form>
      )}
    </div>
  );
}
