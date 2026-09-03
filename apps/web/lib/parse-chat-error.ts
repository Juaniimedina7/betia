export type ChatErrorInfo = { kind: "quota" } | { kind: "auth" } | { kind: "generic" };

/**
 * `useChat`'s top-level `error.message` differs by cause but is never parsed today
 * (see apps/web/app/api/agent/chat/route.ts): a 401 is the plain text "Unauthorized",
 * a 402 is the raw JSON body of the quota-exceeded response, everything else falls
 * through to the route's `onError` string or a browser fetch-failure message. This
 * classifies it so the UI can show the right banner instead of one generic message
 * regardless of cause.
 */
export function parseChatError(error: Error | undefined): ChatErrorInfo | null {
  if (!error) return null;
  if (error.message === "Unauthorized") return { kind: "auth" };
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    if (parsed?.error === "quota_exceeded") return { kind: "quota" };
  } catch {
    // Not JSON — a normal error string, fall through to generic.
  }
  return { kind: "generic" };
}
