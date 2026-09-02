/**
 * Errors surfaced by DB/Redis reads must never reach the end user verbatim — the chat
 * agent and the web pages both surface thrown errors as-is. Call this at a tool
 * boundary so only a generic Spanish message escapes.
 */
export function toUserFacingError(cause: unknown): Error {
  console.error("Odds/cache read failed:", cause);
  return new Error("No pudimos cargar esta información en este momento. Probá de nuevo en unos minutos.");
}
