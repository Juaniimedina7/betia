"use client";

import { useState } from "react";
import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { ComboTicket, type TicketLeg } from "@/components/combo-ticket";

type Status = "idle" | "loading" | "saved" | "error";

/**
 * Wraps ComboTicket (kept purely presentational so it can still render server-side on
 * /apuestas) with a one-click "Aceptar apuesta" action — the only place in the app that
 * calls /api/bets/accept. Shared by the two chat surfaces (agent-chat-panel.tsx and
 * app/agent/page.tsx) so the accept/save logic isn't duplicated alongside their already-
 * duplicated message-rendering loops.
 */
export function AcceptableComboTicket({
  legs,
  multiplier,
  avgEdge,
  avgStatisticalProbability,
  label,
}: {
  legs: TicketLeg[];
  multiplier: number;
  avgEdge?: number;
  avgStatisticalProbability?: number;
  label?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [betSlipId, setBetSlipId] = useState<string | null>(null);

  // Only a combo straight off a live build_combo result carries every field
  // save_bet_slip needs on every leg — guards against rendering a dead button.
  const canAccept = legs.length > 0 && legs.every((leg) => leg.raw);

  const accept = async () => {
    if (!canAccept) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/bets/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legs: legs.map((leg) => leg.raw) }),
      });
      if (!res.ok) throw new Error("save_failed");
      const data = (await res.json()) as { betSlipId: string };
      setBetSlipId(data.betSlipId);
      setStatus("saved");
    } catch (err) {
      console.error("[accept]", err);
      setStatus("error");
    }
  };

  return (
    <div className="space-y-2">
      <ComboTicket
        legs={legs}
        multiplier={multiplier}
        avgEdge={avgEdge}
        avgStatisticalProbability={avgStatisticalProbability}
        label={label}
      />

      {canAccept && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <Show when="signed-in">
            {status === "saved" && betSlipId ? (
              <Link href={`/apuestas/${betSlipId}`} className="btn btn-primary !py-2 !text-sm">
                Guardada ✓ · Ver en Mis apuestas
              </Link>
            ) : (
              <button
                type="button"
                onClick={accept}
                disabled={status === "loading"}
                className="btn btn-primary !py-2 !text-sm disabled:opacity-40"
              >
                {status === "loading" ? "Guardando…" : "Aceptar apuesta"}
              </button>
            )}
            {status === "error" && (
              <span className="text-xs text-red-300">No se pudo guardar. Probá de nuevo.</span>
            )}
          </Show>
          <Show when="signed-out">
            <span className="text-xs text-[var(--color-ink-muted)]">
              Iniciá sesión para guardar esta combinada en Mis apuestas.
            </span>
          </Show>
        </div>
      )}
    </div>
  );
}
