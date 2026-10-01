import { useMemo } from "react";
import type { AnalysisResult } from "@/types/analysis";
import type { PriceLevel } from "@/types/technical";
import type { Timeframe } from "@/types/trade";
import { getInstrument } from "@/lib/instruments";
import { TradeChart } from "@/components/charts/TradeChart";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { CheckList } from "./CheckList";
import { ReasoningPanel } from "./ReasoningPanel";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { TechnicalTable } from "./TechnicalTable";
import { VerdictCard } from "./VerdictCard";

/** Everything about one completed analysis. Used on the analyzer page and in the journal. */
export function AnalysisResultView({ result, compact = false }: { result: AnalysisResult; compact?: boolean }) {
  const instrument = getInstrument(result.trade.pair);
  const levels = useMemo(() => {
    const out: Partial<Record<Timeframe, { support: PriceLevel[]; resistance: PriceLevel[] }>> = {};
    for (const t of result.market?.timeframes ?? []) out[t.timeframe] = { support: t.support, resistance: t.resistance };
    return out;
  }, [result.market]);

  const chart = result.market ? (
    <Panel title="Chart" bodyClassName="p-0">
      <TradeChart
        candles={result.market.candles}
        initialTimeframe={result.trade.timeframe}
        trade={result.trade}
        currentPrice={result.market.price.price}
        levels={levels}
        height={compact ? 300 : 400}
      />
    </Panel>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className={`grid grid-cols-1 gap-3 ${compact ? "" : "xl:grid-cols-[380px_1fr]"}`}>
        <VerdictCard result={result} />
        {chart ??
          (result.state === "BLOCKED" ? (
            <Panel title="Funded-account check">
              <CheckList checks={result.risk.checks} />
            </Panel>
          ) : (
            <Panel title="Market data">
              <Notice tone="warn">
                <div className="font-semibold">ANALYSIS UNAVAILABLE</div>
                <div>{result.unavailable?.message ?? "Market data could not be verified."}</div>
              </Notice>
            </Panel>
          ))}
      </div>

      {result.unavailable?.stage === "AI" && (
        <Notice tone="warn">
          <span className="font-semibold">AI analysis unavailable.</span> {result.unavailable.message} The risk engine results above are
          still valid; no AI verdict is shown.
        </Notice>
      )}

      {(result.ai || result.market) && (
        <div className={`grid grid-cols-1 gap-3 ${compact ? "" : "lg:grid-cols-2 2xl:grid-cols-3"}`}>
          {result.ai && <ReasoningPanel assessment={result.ai.assessment} info={result.ai.info} />}
          {result.ai && <ScoreBreakdown assessment={result.ai.assessment} />}
          {result.market && <TechnicalTable market={result.market} checks={result.marketChecks} instrument={instrument} />}
        </div>
      )}

      {result.trade.thesis && (
        <Panel title="Your thesis">
          <p className="whitespace-pre-wrap text-[12.5px]">{result.trade.thesis}</p>
        </Panel>
      )}
    </div>
  );
}
