/**
 * Errors thrown by the OddsPapi client (status codes, hostnames, response bodies) must
 * never reach the end user — the chat agent and the web pages both surface thrown
 * errors verbatim. Call this at the point a live-fetch + cache-fallback both fail, so
 * only a generic Spanish message escapes the tool boundary.
 */
export function toUserFacingError(cause: unknown): Error {
  console.error("OddsPapi live fetch and cache fallback both failed:", cause);
  return new Error("No pudimos cargar esta información en este momento. Probá de nuevo en unos minutos.");
}
