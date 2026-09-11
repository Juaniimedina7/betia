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
  const [chatId, setChatId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [input, setInput] = useState("");
  
  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: `/api/agent/chat?chatId=${chatId || ''}` }),
  });
  
  const busy = status === "streaming" || status === "submitted";
  const [usage, setUsage] = useState<Usage | null>(null);
  const [betProfile, setBetProfile] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const refreshUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (res.ok) setUsage((await res.json()) as Usage);
    } catch {
      // ignore
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/history");
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
        return data;
      }
    } catch {
      // ignore
    }
    return [];
  }, []);

  // Initialize
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("chatId");
    if (id) setChatId(id);
    
    refreshUsage();
    loadSessions();
  }, [refreshUsage, loadSessions]);

  // Load chat messages when chatId changes
  useEffect(() => {
    if (chatId) {
      fetch(`/api/agent/history/${chatId}`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setMessages(data);
          }
        })
        .catch(console.error);
    } else {
      setMessages([]);
    }
  }, [chatId, setMessages]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile-test")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setBetProfile(data.betProfile ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status === "ready") {
      refreshUsage();
      loadSessions().then(data => {
        if (!chatId && data && data.length > 0) {
          const newId = data[0].id;
          setChatId(newId);
          window.history.replaceState(null, "", `/agent?chatId=${newId}`);
        }
      });
    }
  }, [status, refreshUsage, loadSessions, chatId]);

  const outOfRuns = usage && !usage.admin ? usage.remaining <= 0 : false;

  useEffect(() => {
    const onScroll = () => {
      stickToBottom.current =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 220;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, status]);

  const send = (text: string) => {
    if (!text.trim() || busy || outOfRuns) return;
    sendMessage({ text });
    setInput("");
  };

  const startNewChat = () => {
    setChatId(null);
    window.history.replaceState(null, "", `/agent`);
  };

  return (
    <div className="container-page flex min-h-[calc(100vh-4rem)] max-w-4xl flex-col py-10">
      <div className="mb-6">
        <div className="flex justify-between items-start">
          <span className="eyebrow inline-flex items-center gap-2">
            <span className="live-dot" /> Agente de combinadas
          </span>
          <div className="flex flex-col items-end gap-2">
            {usage && (
              <span className={`chip tnum ${usage.admin ? "chip-edge" : ""}`} title={`Plan ${usage.planId}`}>
                {usage.admin ? "Admin · combinadas ilimitadas" : `${usage.remaining} de ${usage.limit} combinadas este mes`}
              </span>
            )}
            
            <details className="relative group">
              <summary className="chip cursor-pointer list-none hover:border-[rgba(184,255,53,0.4)]">
                Historial de chats ▾
              </summary>
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-white/10 bg-[#0d0d0d] shadow-xl z-50 p-2">
                <button onClick={startNewChat} className="w-full text-left px-3 py-2 text-sm text-[var(--color-edge)] hover:bg-white/5 rounded-lg mb-2">
                  + Nueva conversación
                </button>
                <div className="max-h-60 overflow-y-auto">
                  {sessions.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-[var(--color-ink-muted)]">No hay chats previos.</p>
                  ) : (
                    sessions.map(s => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setChatId(s.id);
                          window.history.replaceState(null, "", `/agent?chatId=${s.id}`);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm truncate rounded-lg transition-colors ${chatId === s.id ? 'bg-white/10 text-white' : 'text-[var(--color-ink-muted)] hover:bg-white/5'}`}
                      >
                        {new Date(s.createdAt).toLocaleDateString()} - {s.title}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </details>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display font-extrabold leading-tight" style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", letterSpacing: "-0.03em" }}>
            Pedí tu combinada
          </h1>
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
                <button key={s} onClick={() => send(s)} className="chip transition-colors hover:border-[rgba(184,255,53,0.4)] hover:text-[var(--color-edge)]">
                  {s}
                </button>
              ))}
            </div>
            {betProfile === "unspecified" && (
              <Link href="/profileTest" className="btn btn-edge mt-4">
                Hacé que tus combinadas se adapten a tu estilo de juego →
              </Link>
            )}
          </div>
        )}

        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div key={message.id} className={`msg-in ${isUser ? "flex justify-end" : ""}`}>
              <div className={isUser ? "max-w-[85%]" : "w-full"}>
                <p className="eyebrow mb-1.5">{isUser ? "Vos" : "BETIA"}</p>
                <div className={isUser ? "rounded-2xl rounded-tr-sm bg-white/[0.06] px-4 py-3 text-sm" : "space-y-3"}>
                  {message.parts && message.parts.map((part, i) => {
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
        <div ref={bottomRef} aria-hidden className="scroll-mb-32" />
      </div>

      {outOfRuns ? (
        <div className="sticky bottom-4 mt-6">
          <div className="card p-5 text-center" style={{ borderColor: "rgba(184,255,53,0.4)", background: "linear-gradient(180deg, rgba(184,255,53,0.06), transparent)" }}>
            <p className="font-display text-lg font-extrabold">Te quedaste sin combinadas este mes</p>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-[var(--color-ink-muted)]">
              Pasate a un plan superior y seguí armando combinadas al instante. Pro te da 600 combinadas por mes.
            </p>
            <Link href="/pricing" className="btn btn-primary mt-4">
              Ver planes →
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="sticky bottom-4 mt-6">
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
