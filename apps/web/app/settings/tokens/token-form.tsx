"use client";

import { useActionState } from "react";

export function TokenForm({ createToken }: { createToken: (formData: FormData) => Promise<string | undefined> }) {
  const [rawToken, formAction, pending] = useActionState<string | undefined, FormData>(
    async (_prev, formData) => createToken(formData),
    undefined,
  );

  return (
    <div className="mb-8">
      <form action={formAction} className="card flex items-center gap-2 p-2">
        <input
          name="label"
          placeholder="Etiqueta (ej. Claude Desktop)"
          className="flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-[var(--color-ink-faint)]"
        />
        <button type="submit" disabled={pending} className="btn btn-primary disabled:opacity-40">
          Crear token
        </button>
      </form>

      {rawToken && (
        <div className="chip chip-gold mt-3 !block break-all p-3 text-sm">
          Guardalo ahora, no se vuelve a mostrar:{" "}
          <code className="tnum">{rawToken}</code>
        </div>
      )}
    </div>
  );
}
