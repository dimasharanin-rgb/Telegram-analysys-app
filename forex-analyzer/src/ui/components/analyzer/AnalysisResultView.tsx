import { useState } from "react";
import type { AnalysisResult } from "@/shared/types/analysis";
import type { Timeframe } from "@/shared/types/trade";
import { getInstrument } from "@/shared/instruments";
import { TradeChart } from "@/ui/components/charts/TradeChart";
import { Notice } from "@/ui/components/ui/Notice";
import { Panel } from "@/ui/components/ui/Panel";
import { CheckList } from "@/ui/components/analyzer/CheckList";
import { ReasoningPanel } from "@/ui/components/analyzer/ReasoningPanel";
import { ScoreBreakdown } from "@/ui/components/analyzer/ScoreBreakdown";
import { TechnicalTable } from "@/ui/components/analyzer/TechnicalTable";
import { VerdictCard } from "@/ui/components/analyzer/VerdictCard";

/** Everything about one completed analysis. Used on the analyzer page and in the journal. */
export function AnalysisResultView({ result, compact = false }: { result: AnalysisResult; compact?: boolean }) {
  const instrument = getInstrument(result.trade.pair);
  const chart = result.market ? (
    <Panel title="Chart at the time of analysis" bodyClassName="p-0">
      <SnapshotChart result={result} height={compact ? 300 : 400} />
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

/** The candles stored with an analysis, with the trade drawn on them. */
function SnapshotChart({ result, height }: { result: AnalysisResult; height: number }) {
  const market = result.market!;
  const timeframes = (Object.keys(market.candles) as Timeframe[]).filter((tf) => (market.candles[tf]?.length ?? 0) > 0);
  const [tf, setTf] = useState<Timeframe>(timeframes.includes(result.trade.timeframe) ? result.trade.timeframe : (timeframes[0] ?? result.trade.timeframe));
  const analysis = market.timeframes.find((t) => t.timeframe === tf);
  return (
    <TradeChart
      symbol={result.trade.pair}
      timeframe={tf}
      timeframes={timeframes}
      onTimeframeChange={setTf}
      candles={market.candles[tf] ?? []}
      currentPrice={market.price.mid}
      trade={result.trade}
      levels={analysis ? { support: analysis.support, resistance: analysis.resistance } : undefined}
      height={height}
    />
  );
}
