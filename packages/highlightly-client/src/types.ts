// Wire-format types for the Highlightly Football API (soccer.highlightly.net), verified
// live against the BASIC (free) plan on 2026-08-31 — see CLAUDE.md's "Highlightly quota"
// section. Unlike API-Football, the BASIC plan has no current-season restriction: the
// `/standings` endpoint returns every team's full home/away/total goals-for/against for
// the live season in a single call, which is what makes this provider viable for the
// Poisson probability model.

export interface RawLeague {
  id: number;
  name: string;
  country: { code: string; name: string };
  seasons: { season: number }[];
}

export interface RawLeaguesResponse {
  data: RawLeague[];
  pagination: { totalCount: number; offset: number; limit: number };
}

interface RawStandingSplit {
  wins: number;
  draws: number;
  loses: number;
  games: number;
  scoredGoals: number;
  receivedGoals: number;
}

interface RawStandingRow {
  team: { id: number; name: string };
  home: RawStandingSplit;
  away: RawStandingSplit;
  total: RawStandingSplit;
  points: number;
  position: number;
}

export interface RawStandingsResponse {
  groups: { name: string; standings: RawStandingRow[] }[];
}

export interface RawHeadToHeadFixture {
  id: number;
  date: string;
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  league: { id: number; name: string; season: number };
  state: { score: { current: string | null } };
}

// Normalized types the rest of the app consumes — string IDs to match this repo's
// convention (see packages/db/src/schema.ts).

export interface HighlightlyLeague {
  leagueId: string;
  name: string;
  countryName: string;
  seasons: number[];
}

export interface TeamGoalSplit {
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface TeamSeasonStanding {
  teamId: string;
  teamName: string;
  leagueId: string;
  season: string;
  home: TeamGoalSplit;
  away: TeamGoalSplit;
}

export interface HeadToHeadFixture {
  fixtureId: string;
  date: string;
  leagueId: string;
  season: string;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface GetLeaguesParams {
  limit?: number;
  offset?: number;
}

export interface GetStandingsParams {
  leagueId: string;
  season: string;
}

export interface GetHeadToHeadParams {
  team1Id: string;
  team2Id: string;
}
