"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AgentToolResult } from "@/components/agent-tool-result";
import { AgentMarkdown } from "@/components/agent-markdown";
import { ChatErrorBanner } from "@/components/chat-error-banner";
import { isToolPart } from "@/lib/agent-tool-output";

interface Usage {
  planId: string;
  used: number;
  limit: number;
  remaining: number;
  admin?: boolean;
}

const SUGGESTIONS = [
  "Armame una combinada de 50x con fútbol de hoy",
  "Una combinada de 5 partidos, perfil conservador",
  "Combinada de 10x con tenis, máximo 3 patas",
];

export default function AgentPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent/chat" }),
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = status === "streaming" || status === "submitted";
  const [usage, setUsage] = useState<Usage | null>(null);

  const refreshUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (res.ok) setUsage((await res.json()) as Usage);
    } catch {
      // ignore — usage is a nicety, enforcement also happens server-side
    }
  }, []);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  useEffect(() => {
    if (status === "ready") refreshUsage();
  }, [status, refreshUsage]);

  const outOfRuns = usage && !usage.admin ? usage.remaining <= 0 : false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const send = (text: string) => {
    if (!text.trim() || busy || outOfRuns) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="container-page flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col py-10">
      <div className="mb-6">
        <span className="eyebrow inline-flex items-center gap-2">
          <span className="live-dot" /> Agente de combinadas
        </span>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <h1
            className="font-display font-extrabold leading-tight"
            style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", letterSpacing: "-0.03em" }}
          >
            Pedí tu combinada
          </h1>
          {usage && (
            <span
              className={`chip tnum ${usage.admin ? "chip-edge" : ""}`}
              title={`Plan ${usage.planId}`}
            >
              {usage.admin
                ? "Admin · combinadas ilimitadas"
                : `${usage.remaining} de ${usage.limit} combinadas este mes`}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-5">
        {messages.length === 0 && (
          <div className="card p-6">
            <p className="text-sm text-[var(--color-ink-muted)]">
              Decile qué buscás y el agente arma la combinada calculando el valor por vos.
              Probá con:
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="chip transition-colors hover:border-[rgba(184,255,53,0.4)] hover:text-[var(--color-edge)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div key={message.id} className={isUser ? "flex justify-end" : ""}>
              <div className={isUser ? "max-w-[85%]" : "w-full"}>
                <p className="eyebrow mb-1.5">{isUser ? "Vos" : "BETIA"}</p>
                <div
                  className={
                    isUser
                      ? "rounded-2xl rounded-tr-sm bg-white/[0.06] px-4 py-3 text-sm"
                      : "space-y-3"
                  }
                >
                  {message.parts.map((part, i) => {
                    if (part.type === "text") {
                      return <AgentMarkdown key={i} text={part.text} />;
                    }
                    if (isToolPart(part)) {
                      return <AgentToolResult key={i} part={part} />;
                    }
                    return null;
                  })}
                </div>
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
            <span className="live-dot" style={{ background: "var(--color-edge)" }} />
            Pensando…
          </div>
        )}

        {error && <ChatErrorBanner error={error} />}
        <div ref={bottomRef} />
      </div>

      {outOfRuns ? (
        <div className="sticky bottom-4 mt-6">
          <div
            className="card p-5 text-center"
            style={{ borderColor: "rgba(184,255,53,0.4)", background: "linear-gradient(180deg, rgba(184,255,53,0.06), transparent)" }}
          >
            <p className="font-display text-lg font-extrabold">Te quedaste sin combinadas este mes</p>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-[var(--color-ink-muted)]">
              Pasate a un plan superior y seguí armando combinadas al instante. Pro te da
              600 combinadas por mes.
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
          className="sticky bottom-4 mt-6"
        >
          <div className="card flex items-center gap-2 p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Armame una combinada de 50x con fútbol de hoy…"
              className="flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-[var(--color-ink-faint)]"
            />
            <button type="submit" disabled={busy || !input.trim()} className="btn btn-primary disabled:opacity-40">
              Enviar
            </button>
          </div>
          <p className="mt-2 px-1 text-center text-xs text-[var(--color-ink-faint)]">
            Recomendación informativa. BETIA no coloca apuestas — vos apostás donde quieras.
          </p>
        </form>
      )}
    </div>
  );
}
