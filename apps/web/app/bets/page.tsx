import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { listUserBetSlips } from "@bet/mcp-tools";

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  saved: "Guardada",
  placed_by_user: "Apostada",
  won: "Ganada",
  lost: "Perdida",
  void: "Anulada",
  push: "Push",
};

export default async function BetsPage() {
  const { userId } = await auth();
  const { betSlips } = await listUserBetSlips({}, { userId: userId! });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Mis apuestas</h1>

      {betSlips.length === 0 && (
        <p className="text-gray-500">
          Todavía no guardaste ninguna combinada. Probá pedirle una al{" "}
          <Link href="/agent" className="underline">
            agente
          </Link>
          .
        </p>
      )}

      <ul className="divide-y divide-black/10 dark:divide-white/10">
        {betSlips.map((slip) => (
          <li key={slip.id} className="py-4">
            <Link href={`/bets/${slip.id}`} className="flex items-center justify-between hover:underline">
              <span>{slip.title ?? `Combo x${slip.combinedOddsDecimal}`}</span>
              <span className="flex items-center gap-3 text-sm text-gray-500">
                <span className="font-mono">{slip.combinedOddsDecimal}x</span>
                <span>{STATUS_LABEL[slip.status] ?? slip.status}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
