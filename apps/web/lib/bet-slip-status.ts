export const BET_SLIP_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Borrador", tone: "var(--color-ink-muted)" },
  saved: { label: "Guardada", tone: "var(--color-ink)" },
  placed_by_user: { label: "Apostada", tone: "var(--color-gold)" },
  won: { label: "Ganada", tone: "var(--color-edge)" },
  lost: { label: "Perdida", tone: "var(--color-danger)" },
  void: { label: "Anulada", tone: "var(--color-ink-muted)" },
  push: { label: "Push", tone: "var(--color-ink-muted)" },
};

export function betSlipStatusLabel(status: string): { label: string; tone: string } {
  return BET_SLIP_STATUS[status] ?? { label: status, tone: "var(--color-ink-muted)" };
}
