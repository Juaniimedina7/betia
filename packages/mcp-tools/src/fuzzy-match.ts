// Shared fuzzy-name resolution: exact case-insensitive match first, then substring
// match either way (target contains candidate, or candidate contains target).
// Originally inline in build-combo.ts for resolving a user-typed bookmaker name
// against whatever's actually cached (e.g. "bet365" -> "af:bet365"); extracted
// 2026-09-08 so get-best-price.ts and find-player-props.ts can apply the same
// tolerance to player names (e.g. "yamal" -> "Lamine Yamal"), which came in raw and
// unnormalized from API-Football (see packages/api-football-client's
// normalizeBookmakers — only "Match Winner" outcomes get translated, nothing else).
export function resolveByName(target: string, candidates: string[]): string | undefined {
  const needle = target.toLowerCase();
  // Defensive: bookmaker_odds is untyped jsonb, and at least one real cached outcome
  // has been observed with a non-string `name` (confirmed live 2026-09-08, root cause
  // not chased down) — skip anything that isn't actually a string rather than throw.
  const stringCandidates = candidates.filter((c): c is string => typeof c === "string");

  const exact = stringCandidates.find((c) => c.toLowerCase() === needle);
  if (exact) return exact;

  return stringCandidates.find((c) => {
    const hay = c.toLowerCase();
    return hay.includes(needle) || needle.includes(hay);
  });
}
