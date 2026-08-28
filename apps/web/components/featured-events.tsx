"use client";

import { useState } from "react";
import Link from "next/link";
import { Reveal } from "@/components/reveal";
import { SportIcon } from "@/components/sport-icon";
import type { FeaturedEvent, FeaturedPick } from "@/lib/featured-events";

type Tab = "destacados" | "vivo" | "proximos";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "destacados", label: "Destacados" },
  { id: "vivo", label: "En vivo" },
  { id: "proximos", label: "Próximos" },
];

/** Signed percentage: real de-vigged edges are often negative, so never hardcode "+". */
function formatEdge(edgePct: number): string {
  return `${edgePct >= 0 ? "+" : "−"}${Math.abs(edgePct).toFixed(1)}%`;
}

function formatKickoff(startTime: string): string {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Left column of the logged-in dashboard: the fixtures with the most value on
 * the board, filtered client-side, plus the band that hands them to the agent.
 */
export function FeaturedEvents({
  events,
  error,
  onPick,
  onCombine,
}: {
  events: FeaturedEvent[];
  error: string | null;
  onPick: (event: FeaturedEvent, pick: FeaturedPick) => void;
  onCombine: () => void;
}) {
  const [tab, setTab] = useState<Tab>("destacados");

  const visible = events.filter((event) =>
    tab === "vivo" ? event.live : tab === "proximos" ? !event.live : true,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 rounded-[14px] border border-[var(--line)] bg-white/[0.02] p-1">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 rounded-[10px] px-2.5 py-2 text-[0.8125rem] font-semibold transition-colors"
              style={
                active
                  ? { background: "rgba(184,255,53,0.1)", color: "var(--color-edge)" }
                  : { color: "var(--color-ink-muted)" }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-2xl border border-[rgba(255,92,108,0.35)] bg-[rgba(255,92,108,0.08)] p-5 text-sm">
          <p className="font-semibold text-[var(--color-danger)]">No pudimos cargar los partidos</p>
          <p className="mt-1 text-[var(--color-ink-muted)]">{error}</p>
        </div>
      )}

      {!error && visible.length === 0 && (
        <p className="card p-6 text-sm text-[var(--color-ink-muted)]">
          {events.length === 0
            ? "Todavía no hay partidos con cuotas cargadas. Volvé en un rato o pedile una combinada al agente."
            : "No hay partidos en esta pestaña ahora mismo."}
        </p>
      )}

      {visible.map((event, i) => (
        <Reveal key={event.fixtureId} delay={Math.min(i * 40, 400)}>
          <article className="card card-hover px-[18px] py-4">
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line-strong)] text-[var(--color-edge)]"
                style={{ background: "rgba(184,255,53,0.06)" }}
              >
                <SportIcon name={event.sportName} className="h-[22px] w-[22px]" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[0.9375rem] font-medium leading-tight">
                    {event.participant1}
                    <span className="mx-2 text-[var(--color-ink-faint)]">vs</span>
                    {event.participant2}
                  </p>
                  {event.live && <LiveBadge />}
                </div>
                <p className="tnum mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">
                  {event.tournamentName}
                  {event.live ? " · En juego" : ` · ${formatKickoff(event.startTime)}`}
                </p>
              </div>

              <span
                className={`chip tnum whitespace-nowrap ${event.edgePct > 0 ? "chip-edge" : ""}`}
                title="Mejor valor del partido contra el precio justo de-vigueado"
              >
                {formatEdge(event.edgePct)} edge
              </span>
            </div>

            <div className="mt-3.5 grid grid-cols-3 gap-2">
              {event.picks.map((pick) => (
                <button
                  key={pick.label}
                  onClick={() => onPick(event, pick)}
                  title={`Pedirle al agente una combinada con ${pick.label}`}
                  className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 transition-colors hover:border-[rgba(184,255,53,0.4)]"
                  style={
                    pick.best
                      ? { border: "1px solid rgba(184,255,53,0.35)", background: "rgba(184,255,53,0.06)" }
                      : { border: "1px solid var(--line-strong)", background: "rgba(255,255,255,0.02)" }
                  }
                >
                  <span className="text-xs text-[var(--color-ink-muted)]">{pick.label}</span>
                  <span
                    className="tnum text-sm font-semibold"
                    style={{ color: pick.best ? "var(--color-edge)" : "var(--color-gold)" }}
                  >
                    {pick.price.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          </article>
        </Reveal>
      ))}

      <div
        className="card relative flex items-center justify-between gap-4 overflow-hidden p-5"
        style={{ borderRadius: "var(--radius-2xl)" }}
      >
        <div className="shimmer-line absolute inset-x-0 top-0 h-px" aria-hidden />
        <div>
          <p
            className="font-display text-[1.05rem] font-extrabold"
            style={{ letterSpacing: "-0.02em" }}
          >
            ¿Querés estos partidos en una sola combinada?
          </p>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            Pedile al agente el multiplicador que buscás y arma el ticket con lo destacado de hoy.
          </p>
        </div>
        <button onClick={onCombine} className="btn btn-ghost whitespace-nowrap">
          Armar con el agente
        </button>
      </div>
    </div>
  );
}

/** Header of the column — kept separate so the grid can align it with the chat panel. */
export function FeaturedEventsHeader() {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <span className="eyebrow">Eventos destacados</span>
        <h2
          className="mt-2.5 font-display text-[1.4rem] font-extrabold leading-[1.15]"
          style={{ letterSpacing: "-0.03em" }}
        >
          Donde hay valor hoy
        </h2>
      </div>
      <Link
        href="/odds"
        className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
      >
        Ver todas las cuotas →
      </Link>
    </div>
  );
}

function LiveBadge() {
  return (
    <span
      className="tnum inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[3px] text-[0.65rem] uppercase"
      style={{
        letterSpacing: "0.1em",
        border: "1px solid rgba(61,216,255,0.35)",
        background: "rgba(61,216,255,0.08)",
        color: "var(--color-live)",
      }}
    >
      <span className="live-dot h-1.5 w-1.5" />
      Live
    </span>
  );
}
