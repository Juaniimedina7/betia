import type { Tournament } from "@bet/oddspapi-client";

/**
 * Region-aware ranking of competitions. Names are matched case-insensitively by
 * substring against the tournament name, so the exact OddsPapi label doesn't
 * have to be known. Country-specific leagues come first, then the big
 * international competitions. Tune freely — it's a display heuristic, not data.
 */
const GLOBAL_POPULAR = [
  "champions league",
  "copa libertadores",
  "premier league",
  "laliga",
  "la liga",
  "serie a",
  "bundesliga",
  "ligue 1",
  "europa league",
  "copa sudamericana",
  "world cup",
  "mundial",
];

const POPULAR_BY_COUNTRY: Record<string, string[]> = {
  AR: ["liga profesional", "copa de la liga", "primera nacional", "copa argentina"],
  ES: ["laliga", "la liga", "copa del rey", "segunda"],
  MX: ["liga mx", "liga bbva", "concacaf"],
  BR: ["brasileir", "copa do brasil", "paulista"],
  GB: ["premier league", "efl", "fa cup", "championship"],
  US: ["mls", "nba", "nfl"],
  CO: ["liga betplay", "primera a"],
  CL: ["primera división", "campeonato"],
  UY: ["primera división"],
  IT: ["serie a", "coppa italia"],
  FR: ["ligue 1", "coupe de france"],
  DE: ["bundesliga", "dfb"],
};

const COUNTRY_NAMES: Record<string, string> = {
  AR: "Argentina",
  ES: "España",
  MX: "México",
  BR: "Brasil",
  GB: "Inglaterra",
  US: "Estados Unidos",
  CO: "Colombia",
  CL: "Chile",
  UY: "Uruguay",
  IT: "Italia",
  FR: "Francia",
  DE: "Alemania",
  PT: "Portugal",
  NL: "Países Bajos",
  PY: "Paraguay",
  PE: "Perú",
  EC: "Ecuador",
  BO: "Bolivia",
  VE: "Venezuela",
};

export function countryName(code?: string): string {
  if (!code) return "Internacional";
  return COUNTRY_NAMES[code.toUpperCase()] ?? code;
}

export interface RankedTournament extends Tournament {
  popularRank: number | null; // lower = more popular; null = not featured
  country: string;
}

/**
 * Ranks tournaments for a viewer's region. Country-specific competitions rank
 * highest, then the global set. Returns everything (with a rank + country
 * label) so the UI can both feature the popular ones and list the rest.
 */
export function rankTournaments(tournaments: Tournament[], regionCountry?: string): RankedTournament[] {
  const region = regionCountry?.toUpperCase();
  const patterns = [...(region ? POPULAR_BY_COUNTRY[region] ?? [] : []), ...GLOBAL_POPULAR];

  return tournaments.map((t) => {
    const name = t.name.toLowerCase();
    let rank: number | null = null;
    for (let i = 0; i < patterns.length; i++) {
      if (name.includes(patterns[i]!)) {
        rank = i;
        break;
      }
    }
    return { ...t, popularRank: rank, country: countryName(t.countryCode) };
  });
}
