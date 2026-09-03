"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { UIMessage } from "ai";
import { AgentToolResult } from "@/components/agent-tool-result";
import { ChatErrorBanner } from "@/components/chat-error-banner";

const SUGGESTIONS = [
  "Armame una combinada de 50x con fútbol de hoy",
  "Una combinada de 5 partidos, perfil conservador",
  "Combinada de 10x con tenis, máximo 3 patas",
];

/**
 * The agent chat as a fixed-height dashboard panel: status header, scrolling
 * transcript (combo tickets included) and a composer. Sending is owned by the
 * parent so the events column can push a prompt into the same conversation.
 */
export function AgentChatPanel({
  messages,
  busy,
  connecting,
  outOfRuns,
  error,
  onSend,
}: {
  messages: UIMessage[];
  busy: boolean;
  connecting: boolean;
  outOfRuns: boolean;
  error?: Error;
  onSend: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // The design pins the transcript to the bottom by scrolling the container
  // itself — scrollIntoView would drag the whole page along with it.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const send = (text: string) => {
    onSend(text);
    setInput("");
  };

  const statusLabel = connecting ? "Conectando…" : busy ? "Pensando…" : "Listo";

  return (
    <section className="card flex h-[640px] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="font-display text-sm font-extrabold" style={{ letterSpacing: "0.02em" }}>
            BET<span style={{ color: "var(--color-edge)" }}>IA</span>
          </span>
          <span className="eyebrow">Agente</span>
        </div>
        <span className="chip">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-edge)" }} />
          {statusLabel}
        </span>
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
        {messages.length === 0 && (
          <p className="shrink-0 text-sm leading-relaxed text-[var(--color-ink-muted)]">
            Decile qué buscás y el agente arma la combinada calculando el valor por vos. Probá
            con una de las sugerencias de abajo.
          </p>
        )}

        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              className={`flex shrink-0 flex-col ${isUser ? "items-end" : "items-start"}`}
            >
              <p className="eyebrow mb-1.5">{isUser ? "Vos" : "BETIA"}</p>
              <div
                className={
                  isUser
                    ? "max-w-[88%] bg-white/[0.06] px-4 py-3 text-sm leading-relaxed"
                    : "w-full space-y-3"
                }
                style={isUser ? { borderRadius: "16px 4px 16px 16px" } : undefined}
              >
                {message.parts.map((part, i) => {
                  if (part.type === "text") {
                    return (
                      <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
                        {part.text}
                      </p>
                    );
                  }
                  if (part.type.startsWith("tool-")) {
                    // shrink-0 is load-bearing: without it the flex column
                    // squeezes result cards and clips their bottom row.
                    return (
                      <div key={i} className="shrink-0">
                        <AgentToolResult part={part} />
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex shrink-0 items-center gap-2 text-sm text-[var(--color-ink-muted)]">
            <span className="live-dot" style={{ background: "var(--color-edge)" }} />
            Pensando…
          </div>
        )}

        {error && <ChatErrorBanner error={error} />}
      </div>

      {outOfRuns ? (
        <div className="border-t border-[var(--line)] p-5">
          <div
            className="card p-5 text-center"
            style={{
              borderColor: "rgba(184,255,53,0.4)",
              background: "linear-gradient(180deg, rgba(184,255,53,0.06), transparent)",
            }}
          >
            <p className="font-display text-base font-extrabold">
              Te quedaste sin combinadas este mes
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--color-ink-muted)]">
              Pasate a un plan superior y seguí armando combinadas al instante. Pro te da 600
              combos por mes.
            </p>
            <Link href="/pricing" className="btn btn-primary mt-4">
              Ver planes →
            </Link>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-[var(--line)] px-5 pb-[18px] pt-3.5"
        >
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="chip transition-colors hover:border-[rgba(184,255,53,0.4)] hover:text-[var(--color-edge)]"
              >
                {suggestion}
              </button>
            ))}
          </div>

          <div className="card mt-3 flex items-center gap-2 p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Armame una combinada de 50x con fútbol de hoy…"
              className="flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-[var(--color-ink-faint)]"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="btn btn-primary disabled:opacity-40"
            >
              Enviar
            </button>
          </div>

          <p className="mt-2 text-center text-xs text-[var(--color-ink-faint)]">
            Recomendación informativa. BETIA no coloca apuestas — vos apostás donde quieras.
          </p>
        </form>
      )}
    </section>
  );
}
