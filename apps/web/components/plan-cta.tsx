"use client";

import { useState } from "react";
import type { PlanId } from "@/lib/plans";

export function PlanCta({
  planId,
  label,
  primary,
  current = false,
}: {
  planId: PlanId;
  label: string;
  primary: boolean;
  /** The signed-in user already has this plan active. */
  current?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const cls = `btn mt-6 w-full ${primary ? "btn-primary" : "btn-ghost"}`;

  if (current) {
    return (
      <button disabled className={`${cls} opacity-50`}>
        Tu plan actual
      </button>
    );
  }

  if (planId === "free") {
    return (
      <a href="/sign-up?plan=free" className={cls}>
        {label}
      </a>
    );
  }

  const go = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      if (res.status === 401) {
        window.location.href = `/sign-up?plan=${planId}`;
        return;
      }
      if (res.status === 409) {
        setMsg("Ya tenés este plan.");
        setLoading(false);
        return;
      }
      if (res.status === 503) {
        setMsg("Los pagos todavía no están habilitados. Volvé pronto.");
        setLoading(false);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setMsg(data.message ?? "No pudimos iniciar el pago. Probá de nuevo.");
      setLoading(false);
    } catch {
      setMsg("No pudimos iniciar el pago. Probá de nuevo.");
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button onClick={go} disabled={loading} className={`${cls} disabled:opacity-50`}>
        {loading ? "Redirigiendo…" : label}
      </button>
      {/* Absolute so the message doesn't push this card's button above the others. */}
      {msg && (
        <p className="absolute inset-x-0 top-full mt-2 text-center text-xs text-[var(--color-danger)]">
          {msg}
        </p>
      )}
    </div>
  );
}
