"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

export default function AgentPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent/chat" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput("");
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold">Agente de combos</h1>
      <p className="text-sm text-gray-500">
        Pedile un combo (ej. &quot;armame un combo de 50x con fútbol de hoy&quot;). Esto es solo una recomendación:
        vos apostás manualmente donde quieras.
      </p>

      <div className="flex-1 space-y-4 overflow-y-auto rounded border border-black/10 p-4 dark:border-white/10">
        {messages.map((message) => (
          <div key={message.id}>
            <p className="text-xs font-semibold uppercase text-gray-400">
              {message.role === "user" ? "Vos" : "Agente"}
            </p>
            {message.parts.map((part, i) => {
              if (part.type === "text") {
                return (
                  <p key={i} className="whitespace-pre-wrap text-sm">
                    {part.text}
                  </p>
                );
              }
              if (part.type.startsWith("tool-")) {
                return (
                  <pre key={i} className="mt-1 overflow-x-auto rounded bg-black/5 p-2 text-xs dark:bg-white/5">
                    {part.type} — {"state" in part ? part.state : ""}
                  </pre>
                );
              }
              return null;
            })}
          </div>
        ))}
        {status === "streaming" && <p className="text-xs text-gray-400">Pensando…</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Armame un combo de 50x con fútbol de hoy..."
          className="flex-1 rounded border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
        />
        <button
          type="submit"
          disabled={status === "streaming"}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
