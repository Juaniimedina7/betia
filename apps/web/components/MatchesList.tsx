"use client";

import { useEffect, useState } from "react";

interface MatchesListProps {
  title?: string;
  team?: string;
  tournamentId?: string;
  limit?: number;
}

export function MatchesList({ 
  title = "Próximos Partidos", 
  team, 
  tournamentId,
  limit = 10 
}: MatchesListProps) {
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchOdds() {
      try {
        const url = new URL("/api/odds", window.location.origin);
        if (team) url.searchParams.set("team", team);
        if (tournamentId) url.searchParams.set("tournamentId", tournamentId);
        url.searchParams.set("limit", limit.toString());

        const response = await fetch(url.toString());
        const json = await response.json();
        if (json.success) {
          setMatches(json.data);
        }
      } catch (err) {
        console.error("Failed to fetch odds:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchOdds();
  }, [team, tournamentId, limit]);

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#B8FF35]"></div>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="text-center p-8 text-gray-500 font-medium">
        No se encontraron partidos.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-[#B8FF35] to-lime-200 mb-8 tracking-tight text-center">
        {title}
      </h2>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {matches.map((match) => {
          const homeTeam = match.participant1Name || "Local";
          const awayTeam = match.participant2Name || "Visitante";
          
          const date = new Date(match.startTime);
          const formattedDate = date.toLocaleDateString("es-AR", {
            weekday: "short",
            day: "numeric",
            month: "short"
          });
          const formattedTime = date.toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit"
          });

          let odds1 = { label: "1", value: "-" };
          let oddsX = { label: "X", value: "-" };
          let odds2 = { label: "2", value: "-" };

          if (match.bookmakerOdds) {
            const bookmakers = Object.keys(match.bookmakerOdds);
            if (bookmakers.length > 0) {
              const firstBookmaker = match.bookmakerOdds[bookmakers[0]];
              // h2h ("1x2") is the main market; fall back to whatever's first if absent.
              const market = firstBookmaker.markets?.["h2h"] || Object.values(firstBookmaker.markets || {})[0];
              if (market?.outcomes) {
                // Outcome names ARE the labels here (a team name, or "Draw") — no
                // catalog lookup needed, unlike OddsPapi's opaque "1"/"2"/"3" ids.
                const outcomes = market.outcomes as Array<{ name: string; price: number }>;
                const home = outcomes.find((o) => o.name === homeTeam);
                const away = outcomes.find((o) => o.name === awayTeam);
                const draw = outcomes.find((o) => o.name === "Draw");
                if (home) odds1 = { label: "1", value: home.price?.toFixed(2) || "-" };
                if (draw) oddsX = { label: "X", value: draw.price?.toFixed(2) || "-" };
                if (away) odds2 = { label: "2", value: away.price?.toFixed(2) || "-" };
              }
            }
          }

          return (
            <div
              key={match.fixtureId}
              className="relative group bg-[#111] border border-gray-800 rounded-2xl overflow-hidden hover:border-[#B8FF35]/50 transition-all duration-300 hover:shadow-[0_0_30px_rgba(184,255,53,0.15)]"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#B8FF35] to-lime-500 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500 ease-out"></div>
              
              <div className="p-6">
                <div className="flex justify-between items-center text-xs text-gray-400 font-semibold mb-6 uppercase tracking-wider">
                  <span>{formattedDate}</span>
                  <span className="bg-[#B8FF35]/10 text-[#B8FF35] py-1 px-3 rounded-full">{formattedTime}</span>
                </div>

                <div className="flex items-center justify-between mb-8">
                  {/* Home Team */}
                  <div className="flex flex-col items-center flex-1 order-1">
                    <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300">
                      <span className="text-sm font-bold text-gray-300 text-center uppercase tracking-wider leading-none px-1 line-clamp-2">
                        {homeTeam.substring(0, 3)}
                      </span>
                    </div>
                    <span className="text-[11px] font-medium text-gray-200 text-center line-clamp-2 px-1">{homeTeam}</span>
                  </div>

                  <div className="flex flex-col items-center flex-1 order-2 px-2">
                    <span className="text-[10px] text-gray-600 font-bold mb-1 uppercase tracking-widest">vs</span>
                  </div>

                  {/* Away Team */}
                  <div className="flex flex-col items-center flex-1 order-3">
                    <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300">
                      <span className="text-sm font-bold text-gray-300 text-center uppercase tracking-wider leading-none px-1 line-clamp-2">
                        {awayTeam.substring(0, 3)}
                      </span>
                    </div>
                    <span className="text-[11px] font-medium text-gray-400 text-center line-clamp-2 px-1">{awayTeam}</span>
                  </div>
                </div>

                <div className="pt-5 border-t border-gray-800">
                  <div className="flex justify-between items-center gap-2">
                    <button className="flex-1 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-white rounded-lg py-2 px-1 transition-colors flex flex-col items-center group/btn">
                      <span className="text-[9px] text-gray-500 font-bold mb-1 uppercase tracking-wider">{odds1.label}</span>
                      <span className="text-sm font-semibold group-hover/btn:text-[#B8FF35]">{odds1.value}</span>
                    </button>
                    <button className="flex-1 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-white rounded-lg py-2 px-1 transition-colors flex flex-col items-center group/btn">
                      <span className="text-[9px] text-gray-500 font-bold mb-1 uppercase tracking-wider">{oddsX.label}</span>
                      <span className="text-sm font-semibold group-hover/btn:text-[#B8FF35]">{oddsX.value}</span>
                    </button>
                    <button className="flex-1 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-white rounded-lg py-2 px-1 transition-colors flex flex-col items-center group/btn">
                      <span className="text-[9px] text-gray-500 font-bold mb-1 uppercase tracking-wider">{odds2.label}</span>
                      <span className="text-sm font-semibold group-hover/btn:text-[#B8FF35]">{odds2.value}</span>
                    </button>
                  </div>
                </div>

                {match.statisticalProbability && (
                  <div
                    className="mt-4 pt-4 border-t border-gray-800"
                    title="Probabilidad estadística (modelo de Poisson sobre goles históricos) — no es la probabilidad de mercado"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Prob. histórica</span>
                      <span className="text-[10px] text-gray-400 font-medium">
                        {Math.round(match.statisticalProbability.homeWinProb * 100)}% · {Math.round(match.statisticalProbability.drawProb * 100)}% · {Math.round(match.statisticalProbability.awayWinProb * 100)}%
                      </span>
                    </div>
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-900">
                      <span style={{ width: `${match.statisticalProbability.homeWinProb * 100}%`, background: "#B8FF35" }} />
                      <span style={{ width: `${match.statisticalProbability.drawProb * 100}%`, background: "#f4c430" }} />
                      <span style={{ width: `${match.statisticalProbability.awayWinProb * 100}%`, background: "#3dd8ff" }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
