import Link from "next/link";

const STATUS_LABELS: Record<string, string> = {
  won: "Ganada",
  lost: "Perdida",
  void: "Anulada",
  saved: "Guardada",
};

/** Compact success confirmation for the two write tools (save_bet_slip, update_bet_slip_outcome). */
export function ToolConfirmationChip({
  toolName,
  output,
}: {
  toolName: "save_bet_slip" | "update_bet_slip_outcome";
  output: unknown;
}) {
  const o = output as { betSlipId?: string; status?: string } | null;
  if (!o?.betSlipId) return null;

  const message =
    toolName === "save_bet_slip"
      ? "Combinada guardada ✓"
      : `Marcada como ${STATUS_LABELS[o.status ?? ""] ?? o.status} ✓`;

  return (
    <Link
      href={`/apuestas/${o.betSlipId}`}
      className="chip chip-edge inline-flex w-fit items-center gap-1.5 tnum transition-colors hover:border-[rgba(184,255,53,0.5)]"
    >
      {message} · Ver en Mis apuestas
    </Link>
  );
}
