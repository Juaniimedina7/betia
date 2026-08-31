// Pragmatic name matching for resolving an OddsPapi participant name to an external
// (Highlightly) team within one league+season roster (never a global search, so
// cross-league ambiguity — e.g. two clubs both named "River" in different
// countries — is essentially eliminated by construction). Exact-normalized match
// first, Levenshtein-similarity fallback second. Not enterprise-grade fuzzy
// matching on purpose — see the "matchConfidence"/"matchStrategy" columns on
// teamIdMap, which exist specifically so a low-confidence match can be audited/
// corrected by hand later.

export interface NamedTeamCandidate {
  teamId: string;
  name: string;
}

const GENERIC_CLUB_TOKENS = new Set([
  "fc",
  "cf",
  "sc",
  "afc",
  "cd",
  "ac",
  "ec",
  "sad",
  "club",
  "de",
  "futbol",
  "football",
]);

export function normalizeTeamName(name: string): string {
  const withoutDiacritics = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const tokens = withoutDiacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !GENERIC_CLUB_TOKENS.has(token));
  return tokens.join(" ");
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) dist[0]![j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i]![j] = Math.min(
        dist[i - 1]![j]! + 1,
        dist[i]![j - 1]! + 1,
        dist[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dist[rows - 1]![cols - 1]!;
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

const FUZZY_MATCH_THRESHOLD = 0.75;

export interface TeamMatch {
  team: NamedTeamCandidate;
  confidence: number;
  strategy: "exact" | "fuzzy";
}

export function resolveTeamName(participantName: string, candidates: NamedTeamCandidate[]): TeamMatch | null {
  const normalizedTarget = normalizeTeamName(participantName);

  for (const candidate of candidates) {
    if (normalizeTeamName(candidate.name) === normalizedTarget) {
      return { team: candidate, confidence: 1, strategy: "exact" };
    }
  }

  let best: TeamMatch | null = null;
  for (const candidate of candidates) {
    const score = similarity(normalizedTarget, normalizeTeamName(candidate.name));
    if (score >= FUZZY_MATCH_THRESHOLD && (!best || score > best.confidence)) {
      best = { team: candidate, confidence: score, strategy: "fuzzy" };
    }
  }
  return best;
}
