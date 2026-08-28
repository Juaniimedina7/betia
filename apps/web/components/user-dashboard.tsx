"use client";

import { useCallback, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AgentChatPanel } from "@/components/agent-chat-panel";
import { FeaturedEvents, FeaturedEventsHeader } from "@/components/featured-events";
import { PLAN_BY_ID, type PlanId } from "@/lib/plans";
import type { FeaturedEvent, FeaturedPick } from "@/lib/featured-events";

export interface DashboardUsage {
  planId: string;
  used: number;
  limit: number;
  remaining: number;
  admin?: boolean;
}

/**
 * Landing for an authenticated user: today's best-value fixtures on the left,
 * the agent chat on the right. Both columns share one conversation, so the
 * event column can hand a prompt straight to the agent.
 */
export function UserDashboard({
  firstName,
  initialUsage,
  events,
  eventsError,
  eventsStale,
  eventsCachedAt,
}: {
  firstName: string | null;
  initialUsage: DashboardUsage | null;
  events: FeaturedEvent[];
  eventsError: string | null;
  eventsStale: boolean;
  eventsCachedAt: string | undefined;
}) {
  const [usage, setUsage] = useState<DashboardUsage | null>(initialUsage);

  const refreshUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (res.ok) setUsage((await res.json()) as DashboardUsage);
    } catch {
      // ignore — usage is a nicety, enforcement also happens server-side
    }
  }, []);

  // Every answered prompt burns a run, so re-read the quota once the stream ends.
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent/chat" }),
    onFinish: () => {
      refreshUsage();
    },
  });

  const busy = status === "streaming" || status === "submitted";
  const outOfRuns = usage && !usage.admin ? usage.remaining <= 0 : false;

  const send = useCallback(
    (text: string) => {
      if (!text.trim() || busy || outOfRuns) return;
      sendMessage({ text });
    },
    [busy, outOfRuns, sendMessage],
  );

  const onPick = (event: FeaturedEvent, pick: FeaturedPick) => {
    send(
      `Armame una combinada que incluya "${pick.label}" en ${event.participant1} vs ${event.participant2}.`,
    );
  };

  const onCombine = () => {
    const names = events
      .slice(0, 3)
      .map((e) => `${e.participant1} vs ${e.participant2}`)
      .join(", ");
    send(
      names
        ? `Armame una combinada con estos partidos destacados: ${names}.`
        : "Armame una combinada con los partidos destacados de hoy.",
    );
  };

  const planName = usage ? (PLAN_BY_ID[usage.planId as PlanId]?.name ?? usage.planId) : null;

  return (
    <div className="container-page pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow inline-flex items-center gap-2">
            <span className="live-dot" /> Tu tablero
          </span>
          <h1
            className="mt-3 font-display font-extrabold leading-[1.1]"
            style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", letterSpacing: "-0.03em" }}
          >
            Hola{firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        {usage && (
          <div className="flex flex-wrap gap-2">
            <span className="chip chip-edge tnum">
              {usage.admin
                ? "Admin · combinadas ilimitadas"
                : `${usage.remaining} de ${usage.limit} combinadas este mes`}
            </span>
            {!usage.admin && <span className="chip">Plan {planName}</span>}
          </div>
        )}
      </div>

      {/* Two rows so the chat panel's top edge lines up with the tab row,
          instead of the prototype's hidden header spacer. */}
      <div className="mt-8 grid gap-5 pb-10 lg:grid-cols-[1.1fr_0.9fr] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="lg:col-start-1 lg:row-start-1">
          <FeaturedEventsHeader />
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <FeaturedEvents
            events={events}
            error={eventsError}
            stale={eventsStale}
            cachedAt={eventsCachedAt}
            onPick={onPick}
            onCombine={onCombine}
          />
        </div>
        <div className="lg:col-start-2 lg:row-start-2">
          <AgentChatPanel
            messages={messages}
            busy={busy}
            connecting={status === "submitted"}
            outOfRuns={outOfRuns}
            onSend={send}
          />
        </div>
      </div>
    </div>
  );
}
