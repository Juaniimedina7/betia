import Link from "next/link";
import { betSlipStatusLabel } from "@/lib/bet-slip-status";

export interface BetSlipRow {
  id: string;
  title: string | null;
  status: string;
  combinedOddsDecimal: string;
  createdAt: string;
}

/** list_user_bet_slips — same status labels and layout pattern as /apuestas' list page. */
export function BetSlipListCard({ betSlips }: { betSlips: BetSlipRow[] }) {
  if (betSlips.length === 0) {
    return (
      <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        Todavía no guardaste ninguna combinada.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[var(--line)] px-5 py-3">
        <span className="eyebrow">Mis apuestas</span>
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {betSlips.map((slip) => {
          const status = betSlipStatusLabel(slip.status);
          return (
            <li key={slip.id}>
              <Link
                href={`/apuestas/${slip.id}`}
                className="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-white/[0.02]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-ink)]">
                    {slip.title ?? "Combinada"}
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: status.tone }}>
                    {status.label}
                  </p>
                </div>
                <span className="tnum shrink-0 font-display text-lg font-black" style={{ color: "var(--color-gold)" }}>
                  {Number(slip.combinedOddsDecimal).toFixed(2)}x
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
