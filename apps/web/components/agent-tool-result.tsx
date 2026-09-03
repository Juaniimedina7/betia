import { AcceptableComboTicket } from "@/components/combo-ticket-accept";
import { ComboTicket } from "@/components/combo-ticket";
import { SimpleListCard } from "@/components/agent-cards/simple-list-card";
import { FixtureListCard, type FixtureSummary } from "@/components/agent-cards/fixture-list-card";
import { OddsCard, type GetOddsOutput } from "@/components/agent-cards/odds-card";
import { BestPriceCard, type GetBestPriceOutput } from "@/components/agent-cards/best-price-card";
import { TeamStatsCard, type GetTeamStatsOutput } from "@/components/agent-cards/team-stats-card";
import { HeadToHeadCard, type GetHeadToHeadOutput } from "@/components/agent-cards/head-to-head-card";
import {
  MatchProbabilityCard,
  type EstimateMatchProbabilityOutput,
} from "@/components/agent-cards/match-probability-card";
import { BetSlipListCard, type BetSlipRow } from "@/components/agent-cards/bet-slip-list-card";
import { ToolConfirmationChip } from "@/components/agent-cards/tool-confirmation-chip";
import { ToolErrorChip } from "@/components/agent-cards/tool-error-chip";
import { extractCombo } from "@/lib/extract-combo";
import { getToolOutput, isToolPart, toolNameOf } from "@/lib/agent-tool-output";

const LOADING_LABELS: Record<string, string> = {
  build_combo: "Armando la combinada…",
  list_sports: "Buscando deportes…",
  list_tournaments: "Buscando torneos…",
  list_fixtures: "Buscando partidos…",
  get_odds: "Consultando cuotas…",
  get_odds_by_tournament: "Consultando cuotas…",
  get_best_price: "Buscando la mejor cuota…",
  get_team_stats: "Consultando estadísticas…",
  get_head_to_head: "Consultando historial…",
  estimate_match_probability: "Calculando probabilidad estadística…",
  save_bet_slip: "Guardando la apuesta…",
  list_user_bet_slips: "Buscando tus apuestas…",
  get_user_bet_slip: "Buscando la apuesta…",
  update_bet_slip_outcome: "Actualizando el resultado…",
};

function LoadingChip({ toolName }: { toolName: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/[0.02] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
      <span className="live-dot" style={{ background: "var(--color-gold)" }} />
      <span>{LOADING_LABELS[toolName] ?? toolName}</span>
    </div>
  );
}

/** Maps get_user_bet_slip's {betSlip, legs} to ComboTicket props — same mapping
 * apps/web/app/apuestas/[betSlipId]/page.tsx already does for the saved-slip detail
 * page, reused here read-only (no accept button, it's already saved). */
function renderUserBetSlip(output: unknown) {
  const o = output as {
    betSlip: { title?: string | null; status?: string; combinedOddsDecimal?: string; reasoning?: string | null } | null;
    legs: Array<{ selectionLabel: string; bookmaker: string; priceDecimal: string; edgePct?: string | null }>;
  } | null;
  if (!o?.betSlip) {
    return <div className="card px-5 py-4 text-sm text-[var(--color-ink-muted)]">No encontré esa apuesta.</div>;
  }
  return (
    <ComboTicket
      legs={o.legs.map((leg) => ({
        selection: leg.selectionLabel,
        detail: leg.bookmaker,
        price: Number(leg.priceDecimal),
        edgePct: leg.edgePct != null ? Number(leg.edgePct) : undefined,
      }))}
      multiplier={Number(o.betSlip.combinedOddsDecimal ?? 0)}
      label={`Estado: ${o.betSlip.status}`}
      note={o.betSlip.reasoning ?? undefined}
    />
  );
}

/**
 * Single dispatcher for any `tool-*` UIMessage part, used by both chat surfaces
 * (agent-chat-panel.tsx and app/agent/page.tsx) so they don't each duplicate the
 * per-tool rendering logic. Renders a loading chip while streaming, ToolErrorChip on
 * `output-error`, and otherwise the result card for that specific tool — falling back
 * to a generic chip for any tool without a dedicated card (e.g. one added later).
 */
export function AgentToolResult({ part }: { part: unknown }) {
  if (!isToolPart(part)) return null;
  const toolName = toolNameOf(part);

  if (part.state === "output-error") {
    return <ToolErrorChip toolName={toolName} />;
  }
  if (part.state !== "output-available") {
    return <LoadingChip toolName={toolName} />;
  }

  if (toolName === "build_combo") {
    const combo = extractCombo(part);
    if (combo && combo.multiplier > 0) {
      return (
        <AcceptableComboTicket
          legs={combo.legs}
          multiplier={combo.multiplier}
          avgEdge={combo.avgEdge}
          avgStatisticalProbability={combo.avgStatisticalProbability}
          label="Combinada del agente"
        />
      );
    }
    return <ToolErrorChip toolName={toolName} />;
  }

  const output = getToolOutput(part);
  if (output === null) return <LoadingChip toolName={toolName} />;

  switch (toolName) {
    case "list_sports": {
      const o = output as { sports?: Array<{ sportId: string; name: string }> };
      return <SimpleListCard title="Deportes" items={(o.sports ?? []).map((s) => ({ id: s.sportId, name: s.name }))} />;
    }
    case "list_tournaments": {
      const o = output as { tournaments?: Array<{ tournamentId: string; name: string }> };
      return (
        <SimpleListCard
          title="Torneos"
          items={(o.tournaments ?? []).map((t) => ({ id: t.tournamentId, name: t.name }))}
        />
      );
    }
    case "list_fixtures":
    case "get_odds_by_tournament": {
      const o = output as { fixtures?: FixtureSummary[] };
      return <FixtureListCard fixtures={o.fixtures ?? []} />;
    }
    case "get_odds":
      return <OddsCard output={output as GetOddsOutput} />;
    case "get_best_price":
      return <BestPriceCard output={output as GetBestPriceOutput} />;
    case "get_team_stats":
      return <TeamStatsCard output={output as GetTeamStatsOutput} />;
    case "get_head_to_head": {
      const input = part.input as { homeTeam?: string; awayTeam?: string } | undefined;
      return (
        <HeadToHeadCard
          output={output as GetHeadToHeadOutput}
          homeTeam={input?.homeTeam}
          awayTeam={input?.awayTeam}
        />
      );
    }
    case "estimate_match_probability":
      return <MatchProbabilityCard output={output as EstimateMatchProbabilityOutput} />;
    case "list_user_bet_slips": {
      const o = output as { betSlips?: BetSlipRow[] };
      return <BetSlipListCard betSlips={o.betSlips ?? []} />;
    }
    case "get_user_bet_slip":
      return renderUserBetSlip(output);
    case "save_bet_slip":
    case "update_bet_slip_outcome":
      return <ToolConfirmationChip toolName={toolName} output={output} />;
    default:
      return (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/[0.02] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
          <span className="live-dot" style={{ background: "var(--color-gold)" }} />
          <span className="tnum">{toolName}</span>
          <span className="text-[var(--color-ink-faint)]">· {part.state}</span>
        </div>
      );
  }
}
