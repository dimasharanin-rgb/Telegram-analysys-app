import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { AnalysisResult } from "@/types/analysis";
import { api } from "@/lib/apiClient";
import { loadLocal, saveLocal } from "@/lib/storage";
import { EMPTY_TRADE_FORM, parseTradeForm, type TradeFormValues } from "@/lib/tradeForm";
import { useAppData } from "@/hooks/useAppData";
import { useRiskPreview } from "@/hooks/useRiskPreview";
import { AnalysisResultView } from "@/components/analyzer/AnalysisResultView";
import { RiskPanel } from "@/components/analyzer/RiskPanel";
import { TradeForm } from "@/components/analyzer/TradeForm";
import { Notice, Spinner } from "@/components/ui/Notice";

const DRAFT_KEY = "fx-analyzer:draft";

export function AnalyzerPage() {
  const { instruments, settings, status } = useAppData();
  const [values, setValues] = useState<TradeFormValues>(() => loadLocal(DRAFT_KEY, EMPTY_TRADE_FORM));
  const [showErrors, setShowErrors] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => saveLocal(DRAFT_KEY, values), [values]);
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  const { trade, errors } = useMemo(() => parseTradeForm(values), [values]);
  const preview = useRiskPreview(trade, settings);

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
    setValues({ ...EMPTY_TRADE_FORM, pair: values.pair, timeframe: values.timeframe });
    setShowErrors(false);
    setResult(null);
    setFailure(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[360px_1fr]">
        <TradeForm
          values={values}
          errors={errors}
          showErrors={showErrors}
          instruments={instruments}
          allowedPairs={settings?.allowedPairs ?? []}
          analyzing={analyzing}
          onChange={setValues}
          onAnalyze={analyze}
          onReset={reset}
        />
        <RiskPanel report={trade ? preview.report : null} loading={preview.loading} error={preview.error} incomplete={!trade} />
      </div>

      {analyzing && (
        <Notice>
          <Spinner
            label={`Checking account rules, loading market data${status?.ai.isMock ? " and running the mock analyst…" : " and asking Claude. This can take up to a minute…"}`}
          />
        </Notice>
      )}
      {failure && <Notice tone="block">{failure}</Notice>}
      {result && !analyzing && (
        <div ref={resultRef} className="flex scroll-mt-3 flex-col gap-3">
          <AnalysisResultView result={result} />
          {result.id && (
            <p className="text-[11.5px] text-faint">
              Saved to the <Link className="text-accent hover:underline" to={`/journal?entry=${result.id}`}>journal</Link>. Record the
              outcome there once the trade is decided.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
