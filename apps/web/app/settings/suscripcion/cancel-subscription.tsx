"use client";

import { useActionState, useState } from "react";

export function CancelSubscription({
  cancel,
  planName,
}: {
  cancel: () => Promise<string | undefined>;
  planName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, formAction, pending] = useActionState<string | undefined, FormData>(
    async () => cancel(),
    undefined,
  );

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-[var(--color-danger)] hover:underline"
      >
        Cancelar suscripción
      </button>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-3 rounded-xl border border-[var(--line)] p-4">
      <p className="text-sm">
        ¿Seguro? Vas a mantener {planName} hasta el fin del mes que ya pagaste, y después pasás a Free.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-ghost text-[var(--color-danger)] disabled:opacity-50"
        >
          {pending ? "Cancelando…" : "Sí, cancelar"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="btn btn-ghost">
          No, seguir
        </button>
      </div>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </form>
  );
}
