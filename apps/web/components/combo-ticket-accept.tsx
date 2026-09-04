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
        <div className="space-y-3 px-1">
          <div className="flex flex-wrap items-center gap-2">
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

          {/* Bookmaker deep links — shown always when available, prominent after saving */}
          {(() => {
            const legsWithLinks = legs.filter((l) => l.deepLink);
            if (legsWithLinks.length === 0) return null;
            // Deduplicate by bookmaker: if all legs share one bookmaker, show one link
            const byBookmaker = new Map<string, { bookmaker: string; deepLink: string }>();
            for (const l of legsWithLinks) {
              const bk = l.detail || "Casa de apuestas";
              if (!byBookmaker.has(bk)) byBookmaker.set(bk, { bookmaker: bk, deepLink: l.deepLink! });
            }
            return (
              <div className="flex flex-wrap gap-2">
                {[...byBookmaker.values()].map((entry) => (
                  <a
                    key={entry.bookmaker}
                    href={entry.deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-edge)]/30 bg-[var(--color-edge)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-edge)] transition-colors hover:bg-[var(--color-edge)]/20"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    Ir a {entry.bookmaker}
                  </a>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
