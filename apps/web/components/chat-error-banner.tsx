import Link from "next/link";
import { parseChatError } from "@/lib/parse-chat-error";

const DANGER_BOX_STYLE = {
  borderColor: "rgba(255,92,108,0.35)",
  background: "rgba(255,92,108,0.08)",
  color: "var(--color-danger)",
} as const;

/**
 * Renders useChat's `error` with a message that actually matches its cause — shared by
 * both chat surfaces, which previously each hand-rolled the same single generic
 * "Algo falló" box regardless of whether the request hit quota, an expired session, or
 * something else (see apps/web/lib/parse-chat-error.ts).
 */
export function ChatErrorBanner({ error }: { error?: Error }) {
  const info = parseChatError(error);
  if (!info) return null;

  if (info.kind === "quota") {
    return (
      <div
        className="card shrink-0 p-4 text-center"
        style={{
          borderColor: "rgba(184,255,53,0.4)",
          background: "linear-gradient(180deg, rgba(184,255,53,0.06), transparent)",
        }}
      >
        <p className="text-sm font-semibold">Te quedaste sin combinadas este mes</p>
        <Link href="/pricing" className="btn btn-primary mt-3 !px-3 !py-1.5 !text-xs">
          Ver planes →
        </Link>
      </div>
    );
  }

  if (info.kind === "auth") {
    return (
      <div className="shrink-0 rounded-xl border px-3 py-2 text-xs" style={DANGER_BOX_STYLE}>
        Tu sesión venció. Recargá la página e iniciá sesión de nuevo.
      </div>
    );
  }

  return (
    <div className="shrink-0 rounded-xl border px-3 py-2 text-xs" style={DANGER_BOX_STYLE}>
      Algo falló armando la respuesta. Probá de nuevo en un momento.
    </div>
  );
}
