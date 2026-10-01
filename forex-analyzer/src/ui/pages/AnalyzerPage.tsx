import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { AnalysisResult } from "@/shared/types/analysis";
import { formatPrice, getInstrument } from "@/shared/instruments";
import { api } from "@/ui/lib/apiClient";
import { loadLocal, saveLocal } from "@/ui/lib/storage";
import { EMPTY_TRADE_FORM, marketEntry, parseTradeForm, type TradeFormValues } from "@/ui/lib/tradeForm";
import { useAppData } from "@/ui/hooks/useAppData";
import { useLiveFeed } from "@/ui/hooks/useLiveFeed";
import { useRiskPreview } from "@/ui/hooks/useRiskPreview";
import { AnalysisResultView } from "@/ui/components/analyzer/AnalysisResultView";
import { RiskPanel } from "@/ui/components/analyzer/RiskPanel";
import { TradeForm } from "@/ui/components/analyzer/TradeForm";
import { LiveChart } from "@/ui/components/market/LiveChart";
import { MarketContext } from "@/ui/components/market/MarketContext";
import { MarketHeader } from "@/ui/components/market/MarketHeader";
import { Notice, Spinner } from "@/ui/components/ui/Notice";
import { Panel } from "@/ui/components/ui/Panel";

const DRAFT_KEY = "fx-analyzer:draft";

export function AnalyzerPage() {
  const { settings, status } = useAppData();
  const feed = useLiveFeed();
  const [values, setValues] = useState<TradeFormValues>(() => ({ ...loadLocal(DRAFT_KEY, EMPTY_TRADE_FORM), pair: feed.symbol }));
  const [showErrors, setShowErrors] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const instrument = getInstrument(feed.symbol);

  // The pair is chosen in the market header.
  useEffect(() => setValues((v) => (v.pair === feed.symbol ? v : { ...v, pair: feed.symbol, entry: v.entryType === "MARKET" ? "" : v.entry })), [feed.symbol]);

  // MARKET entry follows the live price (rounded to the quote precision); typing switches to CUSTOM.
  const live = marketEntry(feed.quote, values.direction);
  useEffect(() => {
    if (values.entryType !== "MARKET" || live === null) return;
    const text = formatPrice(live, instrument);
    setValues((v) => (v.entry === text ? v : { ...v, entry: text }));
  }, [values.entryType, live, instrument]);

  useEffect(() => saveLocal(DRAFT_KEY, values), [values]);
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  const { trade, errors } = useMemo(() => parseTradeForm(values), [values]);
  // With MARKET entry the price moves every tick; the risk preview only re-runs when it moves by a whole pip.
  const previewTrade = useMemo(() => {
    if (!trade || values.entryType !== "MARKET" || !instrument) return trade;
    const pip = instrument.pipSize;
    return { ...trade, entry: Number((Math.round(trade.entry / pip) * pip).toFixed(instrument.pricePrecision)) };
  }, [trade, values.entryType, instrument]);
  const preview = useRiskPreview(previewTrade, settings);

  const analyze = async () => {
    setShowErrors(true);
    if (!trade) return;
    setAnalyzing(true);
    setFailure(null);
    try {
      setResult(await api.analyze(trade));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "The analysis request failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = () => {
    setValues({ ...EMPTY_TRADE_FORM, pair: feed.symbol, timeframe: values.timeframe, entryType: values.entryType });
    setShowErrors(false);
    setResult(null);
    setFailure(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <MarketHeader />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_340px]">
        <Panel bodyClassName="p-0" className="min-w-0">
          <LiveChart trade={trade ?? { entry: Number(values.entry) || null, stopLoss: Number(values.stopLoss) || null, takeProfit: Number(values.takeProfit) || null }} />
        </Panel>
        <TradeForm
          values={values}
          errors={errors}
          showErrors={showErrors}
          instrument={instrument}
          marketAvailable={live !== null}
          analyzing={analyzing}
          onChange={setValues}
          onAnalyze={analyze}
          onReset={reset}
        />
      </div>
      <MarketContext />
      <RiskPanel report={trade ? preview.report : null} loading={preview.loading} error={preview.error} incomplete={!trade} />

      {analyzing && (
        <Notice>
          <Spinner label={`Loading a fresh market snapshot, checking account rules${status?.ai.isMock ? " and running the mock analyst…" : " and asking Claude. This can take up to a minute…"}`} />
        </Notice>
      )}
      {failure && <Notice tone="block">{failure}</Notice>}
      {result && !analyzing && (
        <div ref={resultRef} className="flex scroll-mt-3 flex-col gap-3">
          <AnalysisResultView result={result} />
          {result.id && (
            <p className="text-[11.5px] text-faint">
              Saved to the <Link className="text-accent hover:underline" to={`/journal?entry=${result.id}`}>journal</Link>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
