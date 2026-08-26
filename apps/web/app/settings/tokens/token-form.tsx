"use client";

import { useActionState } from "react";

export function TokenForm({ createToken }: { createToken: (formData: FormData) => Promise<string | undefined> }) {
  const [rawToken, formAction, pending] = useActionState<string | undefined, FormData>(
    async (_prev, formData) => createToken(formData),
    undefined,
  );

  return (
    <div className="mb-8">
      <form action={formAction} className="flex gap-2">
        <input
          name="label"
          placeholder="Etiqueta (ej. Claude Desktop)"
          className="flex-1 rounded border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-transparent"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Crear token
        </button>
      </form>

      {rawToken && (
        <p className="mt-3 break-all rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Guardalo ahora, no se vuelve a mostrar: <code className="font-mono">{rawToken}</code>
        </p>
      )}
    </div>
  );
}
