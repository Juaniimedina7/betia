"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookmakerOdds } from "@bet/odds-api-client";
import { marketLabel as curatedMarketLabel, outcomeLabel as curatedOutcomeLabel } from "@bet/mcp-tools/market-labels";

// Each supported sport's main "who wins" market always floats to the top of the board.
const PRIORITY_MARKET_IDS = ["h2h", "spreads", "totals"];

// This page shows every market API-Football returns (unlike the agent chat's
// toCuratedOddsOutput, which deliberately drops anything without a real curated label
// to keep the tool response small — see packages/mcp-tools/src/market-labels.ts).
// exact_score is intentionally kept OUT of that shared curated map for that reason, but
// this full-page table still deserves a real Spanish label for it, so it's added here
// instead of in the shared file (adding it there would make the chat curate it in too).
const PAGE_ONLY_MARKET_LABELS: Record<string, string> = {
  exact_score: "Resultado exacto",

  // Time-window 1X2 / goal-line
  "1x2_15_minutes": "1X2 a los 15 minutos",
  "1x2_30_minutes": "1X2 a los 30 minutos",
  "1x2_60_minutes": "1X2 a los 60 minutos",
  "1x2_75_minutes": "1X2 a los 75 minutos",
  goal_line: "Línea de goles",
  goal_line_1st_half: "Línea de goles 1er tiempo",

  // Handicap variants
  asian_handicap_2nd_half: "Hándicap asiático 2do tiempo",
  asian_handicap_first_half: "Hándicap asiático 1er tiempo",
  european_handicap_2nd_half: "Hándicap europeo 2do tiempo",
  handicap_result: "Resultado con hándicap",
  handicap_result_first_half: "Resultado con hándicap 1er tiempo",

  // Away-team-specific
  away_anytime_goal_scorer: "Goleador visitante (en cualquier momento)",
  away_come_from_behind_and_win: "Visitante remonta y gana",
  away_corners_over_under: "Más/menos córners del visitante",
  away_first_goal_scorer: "Primer goleador visitante",
  away_goal_method_header: "Visitante anota de cabeza",
  away_highest_scoring_half: "Tiempo con más goles del visitante",
  away_last_goal_scorer: "Último goleador visitante",
  away_odd_even: "Goles del visitante par/impar",
  away_player_shots_on_target_total: "Tiros al arco de jugador visitante",
  away_player_shots_total: "Tiros de jugador visitante",
  away_team_exact_goals_number: "Cantidad exacta de goles del visitante",
  away_team_score_a_goal: "El visitante anota un gol",
  away_team_score_a_goal_1st_half: "El visitante anota un gol (1er tiempo)",
  away_team_score_a_goal_2nd_half: "El visitante anota un gol (2do tiempo)",
  away_team_total_cards: "Total de tarjetas del visitante",
  away_team_total_goals_1st_half: "Total de goles del visitante (1er tiempo)",
  away_team_total_goals_2nd_half: "Total de goles del visitante (2do tiempo)",
  away_team_will_score_in_both_halves: "El visitante anota en ambos tiempos",
  away_team_yellow_cards: "Tarjetas amarillas del visitante",
  away_total_corners_1st_half: "Total de córners del visitante (1er tiempo)",
  away_total_corners_2nd_half: "Total de córners del visitante (2do tiempo)",
  away_win_both_halves: "El visitante gana ambos tiempos",

  // Home-team-specific (mirrors away)
  home_anytime_goal_scorer: "Goleador local (en cualquier momento)",
  home_away: "Local/visitante",
  home_come_from_behind_and_win: "Local remonta y gana",
  home_corners_over_under: "Más/menos córners del local",
  home_first_goal_scorer: "Primer goleador local",
  home_goal_method_header: "Local anota de cabeza",
  home_highest_scoring_half: "Tiempo con más goles del local",
  home_last_goal_scorer: "Último goleador local",
  home_odd_even: "Goles del local par/impar",
  home_player_shots_on_target_total: "Tiros al arco de jugador local",
  home_team_exact_goals_number: "Cantidad exacta de goles del local",
  home_team_score_a_goal: "El local anota un gol",
  home_team_score_a_goal_1st_half: "El local anota un gol (1er tiempo)",
  home_team_score_a_goal_2nd_half: "El local anota un gol (2do tiempo)",
  home_team_total_cards: "Total de tarjetas del local",
  home_team_total_goals_1st_half: "Total de goles del local (1er tiempo)",
  home_team_total_goals_2nd_half: "Total de goles del local (2do tiempo)",
  home_team_will_score_in_both_halves: "El local anota en ambos tiempos",
  home_team_yellow_cards: "Tarjetas amarillas del local",
  home_total_corners_1st_half: "Total de córners del local (1er tiempo)",
  home_total_corners_2nd_half: "Total de córners del local (2do tiempo)",
  home_win_both_halves: "El local gana ambos tiempos",

  // Both-teams-to-score variants
  both_teams_score_first_half: "Ambos anotan (1er tiempo)",
  both_teams_to_score_in_both_halves: "Ambos anotan en los dos tiempos",
  both_teams_to_score_second_half: "Ambos anotan (2do tiempo)",
  results_both_teams_score: "Resultado y ambos anotan",
  total_goals_both_teams_to_score: "Total de goles y ambos anotan",

  // Cards
  cards_asian_handicap: "Hándicap asiático de tarjetas",
  cards_european_handicap: "Hándicap europeo de tarjetas",
  cards_over_under: "Más/menos tarjetas",
  cards_over_under_between_0_and_10_m: "Más/menos tarjetas (0 a 10 min)",
  yellow_asian_handicap: "Hándicap asiático de amarillas",
  yellow_asian_handicap_1st_half: "Hándicap asiático de amarillas (1er tiempo)",
  yellow_asian_handicap_2nd_half: "Hándicap asiático de amarillas (2do tiempo)",
  yellow_cards_1x2: "1X2 de tarjetas amarillas",
  yellow_cards_1x2_1st_half: "1X2 de tarjetas amarillas (1er tiempo)",
  yellow_cards_1x2_2nd_half: "1X2 de tarjetas amarillas (2do tiempo)",
  yellow_double_chance: "Doble oportunidad de amarillas",
  yellow_odd_even: "Tarjetas amarillas par/impar",
  yellow_over_under: "Más/menos tarjetas amarillas",
  yellow_over_under_1st_half: "Más/menos tarjetas amarillas (1er tiempo)",
  yellow_over_under_2nd_half: "Más/menos tarjetas amarillas (2do tiempo)",
  red_card_in_the_match_1st_half: "Tarjeta roja en el partido (1er tiempo)",
  first_card_received_3_way: "Quién recibe la primera tarjeta",

  // Clean sheet / win to nil
  clean_sheet_away: "Visitante no recibe goles",
  clean_sheet_home: "Local no recibe goles",
  win_to_nil: "Gana sin recibir goles",
  win_to_nil_away: "Visitante gana sin recibir goles",
  win_to_nil_home: "Local gana sin recibir goles",

  // Corners
  corners_1x2: "1X2 de córners",
  corners_1x2_1st_half: "1X2 de córners (1er tiempo)",
  corners_1x2_2nd_half: "1X2 de córners (2do tiempo)",
  corners_asian_handicap: "Hándicap asiático de córners",
  corners_asian_handicap_1st_half: "Hándicap asiático de córners (1er tiempo)",
  corners_asian_handicap_2nd_half: "Hándicap asiático de córners (2do tiempo)",
  corners_double_chance: "Doble oportunidad de córners",
  corners_european_handicap: "Hándicap europeo de córners",
  corners_odd_even: "Córners par/impar",
  corners_over_under: "Más/menos córners",
  corners_race_to: "Primero en llegar a X córners",
  corners_total_between_0_and_10m: "Total de córners (0 a 10 min)",
  corners_total_range: "Rango de córners totales",
  total_corners_1st_half: "Total de córners (1er tiempo)",
  total_corners_2nd_half: "Total de córners (2do tiempo)",
  total_corners_3_way: "Total de córners (3 vías)",
  multicorners: "Múltiples córners",

  // Correct/exact score & goal counts
  correct_score_first_half: "Resultado exacto (1er tiempo)",
  correct_score_second_half: "Resultado exacto (2do tiempo)",
  exact_goals_number: "Cantidad exacta de goles",
  exact_goals_number_first_half: "Cantidad exacta de goles (1er tiempo)",
  second_half_exact_goals_number: "Cantidad exacta de goles (2do tiempo)",
  result_total_goals: "Resultado y total de goles",
  number_of_goals_in_match: "Cantidad de goles del partido",
  own_goal: "Gol en contra",
  scoring_draw: "Empate con goles",

  // Double chance / draw no bet
  double_chance_first_half: "Doble oportunidad (1er tiempo)",
  double_chance_second_half: "Doble oportunidad (2do tiempo)",
  draw_no_bet_1st_half: "Empate anula la apuesta (1er tiempo)",
  draw_no_bet_2nd_half: "Empate anula la apuesta (2do tiempo)",

  // Half winners / split-half markets
  first_half_winner: "Ganador del 1er tiempo",
  second_half_winner: "Ganador del 2do tiempo",
  first_10_min_winner: "Ganador de los primeros 10 minutos",
  highest_scoring_half: "Tiempo con más goles",
  ht_ft_double: "Resultado 1er tiempo / final combinado",
  win_both_halves: "Gana ambos tiempos",
  to_win_either_half: "Gana algún tiempo",
  goals_over_under_first_half: "Más/menos goles (1er tiempo)",
  goals_over_under_second_half: "Más/menos goles (2do tiempo)",
  odd_even_first_half: "Par/impar (1er tiempo)",
  odd_even_second_half: "Par/impar (2do tiempo)",

  // Goal scorer / method
  first_goal_method: "Método del primer gol",
  first_goal_scorer: "Primer goleador",
  last_goal_scorer: "Último goleador",
  first_team_to_score_3_way_1st_half: "Primer equipo en anotar (1er tiempo, 3 vías)",
  goal_method_outside_the_box: "Gol de fuera del área",
  team_to_score_last: "Último equipo en anotar",
  player_to_score_or_assist: "Jugador anota o asiste",

  // Goal-time windows
  goal_in_1_15_minutes: "Gol entre el minuto 1 y 15",
  goal_in_16_30_minutes: "Gol entre el minuto 16 y 30",
  goal_in_31_45_minutes: "Gol entre el minuto 31 y 45",
  goal_in_46_60_minutes: "Gol entre el minuto 46 y 60",
  goal_in_61_75_minutes: "Gol entre el minuto 61 y 75",
  goal_in_76_90_minutes: "Gol entre el minuto 76 y 90",
  over_under_15m_30m: "Más/menos goles (15 a 30 min)",
  over_under_30m_45m: "Más/menos goles (30 a 45 min)",

  // Fouls
  fouls_1x2: "1X2 de faltas",
  fouls_away_total: "Total de faltas del visitante",
  fouls_double_chance: "Doble oportunidad de faltas",
  fouls_handicap: "Hándicap de faltas",
  fouls_home_total: "Total de faltas del local",
  fouls_odd_even: "Faltas par/impar",
  fouls_total: "Total de faltas",
  player_fouls_committed: "Faltas cometidas por jugador",

  // Offsides
  offsides_1x2: "1X2 de offsides",
  offsides_away_total: "Total de offsides del visitante",
  offsides_double_chance: "Doble oportunidad de offsides",
  offsides_handicap: "Hándicap de offsides",
  offsides_home_total: "Total de offsides del local",
  offsides_total: "Total de offsides",

  // Shots
  shotontarget_1x2: "1X2 de tiros al arco",
  shotontarget_handicap: "Hándicap de tiros al arco",
  shots_1x2: "1X2 de tiros",
  total_shotongoal: "Total de tiros al arco",
  total_shots: "Total de tiros",
  total_tackles: "Total de entradas (tackles)",

  // Penalties
  to_miss_a_penalty: "Erra un penal",
  to_score_a_penalty: "Convierte un penal",

  // Scoring patterns
  to_score_in_both_halves: "Anota en ambos tiempos",
  to_score_in_both_halves_by_teams: "Equipo anota en ambos tiempos",
  to_win_from_behind: "Gana tras ir perdiendo",

  // Per-side totals
  total_away: "Total del visitante",
  total_home: "Total del local",

  // Misc
  winning_margin: "Margen de victoria",
  goalkeeper_saves: "Atajadas del arquero",
};

// Last-resort fallback for a market key with no curated label anywhere yet (API-Football
// can return dozens of niche bet types — see slugifyMarketName in
// packages/api-football-client) — better than showing the raw snake_case slug.
function humanizeMarketId(marketId: string): string {
  const words = marketId.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function marketLabel(marketId: string): string {
  const curated = curatedMarketLabel(marketId);
  if (curated !== marketId) return curated;
  return PAGE_ONLY_MARKET_LABELS[marketId] ?? humanizeMarketId(marketId);
}

const outcomeKey = (name: string, point: number | undefined) => `${name}|${point ?? ""}`;

export function LiveOddsTable({
  fixtureId,
  initialOdds,
}: {
  fixtureId: string;
  initialOdds: BookmakerOdds;
}) {
  const [odds, setOdds] = useState<BookmakerOdds>(initialOdds);
  const [connected, setConnected] = useState(false);
  const [activeMarketId, setActiveMarketId] = useState<string | null>(null);

  useEffect(() => {
    const source = new EventSource(`/api/sse/odds?fixtureId=${encodeURIComponent(fixtureId)}`);
    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("odds", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { bookmakerOdds: BookmakerOdds | null };
      if (payload.bookmakerOdds) setOdds(payload.bookmakerOdds);
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [fixtureId]);

  const { markets, bookmakers, bestPrices, activeMarketData, totalRows } = useMemo(() => {
    const bookmakerSet = new Set<string>();
    const marketMap = new Map<string, { label: string; outcomes: Map<string, number | undefined> }>();

    // First pass: collect all bookmakers, markets, and outcomes
    for (const [bookmaker, book] of Object.entries(odds)) {
      bookmakerSet.add(bookmaker);
      for (const [marketId, market] of Object.entries(book?.markets ?? {})) {
        if (!marketMap.has(marketId)) {
          marketMap.set(marketId, { label: marketLabel(marketId), outcomes: new Map() });
        }
        const m = marketMap.get(marketId)!;
        for (const outcome of market.outcomes ?? []) {
          m.outcomes.set(outcomeKey(outcome.name, outcome.point), outcome.point);
        }
      }
    }

    const bookmakers = Array.from(bookmakerSet).sort((a, b) => {
      // Put pinnacle first if it exists
      if (a === "pinnacle") return -1;
      if (b === "pinnacle") return 1;
      return a.localeCompare(b);
    });

    const markets = Array.from(marketMap.entries())
      .map(([id, data]) => ({ id, label: data.label, outcomes: Array.from(data.outcomes.keys()) }))
      .sort((a, b) => {
        const ai = PRIORITY_MARKET_IDS.indexOf(a.id);
        const bi = PRIORITY_MARKET_IDS.indexOf(b.id);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        return a.label.localeCompare(b.label);
      });

    // Calculate best prices for the active market
    const currentMarketId = activeMarketId ?? markets[0]?.id;
    const bestPrices = new Map<string, number>();

    let activeMarketData = null;
    if (currentMarketId) {
      activeMarketData = markets.find((m) => m.id === currentMarketId);
      if (activeMarketData) {
        for (const key of activeMarketData.outcomes) {
          let best = 0;
          for (const bm of bookmakers) {
            const outcome = odds[bm]?.markets[currentMarketId]?.outcomes.find((o) => outcomeKey(o.name, o.point) === key);
            if (outcome && outcome.price > best) best = outcome.price;
          }
          if (best > 0) bestPrices.set(key, best);
        }
      }
    }

    let totalRowsCount = 0;
    for (const bm of Object.keys(odds)) {
      for (const mId of Object.keys(odds[bm]?.markets ?? {})) {
        totalRowsCount += odds[bm]?.markets[mId]?.outcomes.length ?? 0;
      }
    }

    return { markets, bookmakers, bestPrices, activeMarketData, totalRows: totalRowsCount };
  }, [odds, activeMarketId]);

  // Sync active market if it's null
  useEffect(() => {
    if (!activeMarketId && markets.length > 0) {
      setActiveMarketId(markets[0].id);
    }
  }, [markets, activeMarketId]);

  const outcomeLabel = (key: string) => {
    const [name, pointStr] = key.split("|");
    return curatedOutcomeLabel(name, pointStr ? Number(pointStr) : undefined);
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <span className="flex items-center gap-2 text-sm">
          <span className="live-dot" style={connected ? undefined : { background: "var(--color-ink-faint)", animation: "none" }} />
          <span className={connected ? "text-[var(--color-live)]" : "text-[var(--color-ink-muted)]"}>
            {connected ? "En vivo" : "Conectando…"}
          </span>
        </span>
        <span className="chip">{bookmakers.length} casas</span>
      </div>

      {totalRows === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[var(--color-ink-muted)]">
          Todavía no hay cuotas cacheadas para este partido.
        </p>
      ) : (
        <>
          <div className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.01)] px-5 py-4">
            <label htmlFor="market-select" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
              Mercado
            </label>
            <div className="relative">
              <select
                id="market-select"
                value={activeMarketId ?? ""}
                onChange={(e) => setActiveMarketId(e.target.value)}
                className="w-full appearance-none rounded-xl border border-[var(--line-strong)] bg-[rgba(255,255,255,0.02)] px-4 py-2.5 pr-10 text-sm font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-ink-muted)] focus:border-[var(--color-edge)] focus:outline-none"
              >
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)]">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </div>

          {!activeMarketData ? (
            <p className="px-5 py-10 text-center text-sm text-[var(--color-ink-muted)]">
              No se encontraron datos para este mercado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.02)] text-left text-xs uppercase tracking-wider text-[var(--color-ink-faint)]">
                    <th className="sticky left-0 z-10 bg-[var(--color-bg)] px-5 py-3 font-semibold shadow-[1px_0_0_0_var(--line)]">
                      Selección
                    </th>
                    {bookmakers.map((bm) => (
                      <th key={bm} className="px-5 py-3 font-semibold text-center whitespace-nowrap capitalize">
                        {bm}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {activeMarketData.outcomes.map((key) => (
                    <tr key={key} className="transition-colors hover:bg-white/[0.02]">
                      <td className="sticky left-0 z-10 bg-[var(--color-bg)] px-5 py-3 font-medium text-[var(--color-ink)] shadow-[1px_0_0_0_var(--line)] whitespace-nowrap">
                        {outcomeLabel(key)}
                      </td>
                      {bookmakers.map((bm) => {
                        const outcome = odds[bm]?.markets[activeMarketData!.id]?.outcomes.find(
                          (o) => outcomeKey(o.name, o.point) === key,
                        );
                        const price = outcome?.price;
                        const isBest = price !== undefined && bestPrices.get(key) === price;

                        return (
                          <td key={bm} className="px-5 py-3 text-center">
                            {price === undefined ? (
                              <span className="text-[var(--color-ink-faint)]">—</span>
                            ) : (
                              <span
                                className="tnum inline-flex items-center gap-1 font-semibold"
                                style={{ color: isBest ? "var(--color-edge)" : "var(--color-ink)" }}
                              >
                                {isBest && <span aria-hidden className="text-[10px]">▲</span>}
                                {price.toFixed(2)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="border-t border-[var(--line)] px-5 py-3 text-xs text-[var(--color-ink-muted)] leading-relaxed bg-[rgba(255,255,255,0.01)]">
        <span style={{ color: "var(--color-edge)" }}>▲</span> mejor precio disponible por selección.<br />
        Las cuotas mostradas representan el multiplicador de tu apuesta. Una cuota vacía significa que la casa no ofrece ese mercado actualmente.
      </p>
    </div>
  );
}
