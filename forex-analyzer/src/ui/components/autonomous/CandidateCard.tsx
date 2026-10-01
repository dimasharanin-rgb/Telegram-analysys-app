import type { AutonomousAnalysisResult } from "@/shared/types/autonomous";
import type { SetupCandidate } from "@/shared/types/setup";
import { formatPrice, getInstrument } from "@/shared/instruments";
import { formatMoney } from "@/shared/format";
import { Button } from "@/ui/components/ui/Button";
import { Spinner } from "@/ui/components/ui/Notice";
import { DirectionTag } from "@/ui/components/ui/VerdictBadge";

interface Props {
  candidate: SetupCandidate;
  result: AutonomousAnalysisResult | null;
  analyzing: boolean;
  error: string | null;
  onAnalyze: () => void;
}

/** One deterministic candidate, and (after analysis) the AI decision, the risk validation and the final analysis decision. */
export function CandidateCard({ candidate, result, analyzing, error, onAnalyze }: Props) {
  const own = candidate.marketContext[0]!;
  const instrument = getInstrument(candidate.symbol);
  const px = (v: number | null | undefined) => (v == null ? "—" : formatPrice(v, instrument));
  return (
    <article className="flex flex-col gap-3 rounded-md border border-line bg-panel p-3" data-testid="candidate">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num text-[14px] font-semibold">{candidate.symbol}</span>
        <span className="num text-muted">{candidate.timeframe}</span>
        <DirectionTag direction={candidate.direction} />
        <span className="font-semibold">{candidate.setupType}</span>
        <span className="ml-auto text-[11px] text-faint" title="Share of the detector's conditions that held. Not a probability.">
          conditions met {Math.round(candidate.completeness * 100)}%
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12px] sm:grid-cols-4">
        <Fact label="Trend" value={own.trend.direction} />
        <Fact label="Structure" value={`${own.structure.bias} ${own.structure.sequence.slice(-2).join("/")}`} />
        <Fact label="Momentum" value={own.momentum.state} />
        <Fact label="ATR" value={own.volatility.state} />
        <Fact label="Support" value={px(candidate.referenceLevels.nearestSupport)} />
        <Fact label="Resistance" value={px(candidate.referenceLevels.nearestResistance)} />
        {candidate.triggerPrice !== undefined && <Fact label="Trigger" value={px(candidate.triggerPrice)} />}
        <Fact label="Context" value={candidate.contextTimeframes.join(", ") || "—"} />
      </dl>
      <details className="text-[11.5px] text-muted">
        <summary className="cursor-pointer">Why it was flagged ({candidate.reasons.length})</summary>
        <ul className="mt-1 list-disc pl-4">
          {candidate.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>
      {!result && (
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={onAnalyze} disabled={analyzing}>
            {analyzing ? "Analyzing…" : "Analyze candidate"}
          </Button>
          {analyzing && <Spinner />}
          {error && <span className="text-[12px] text-block">{error}</span>}
        </div>
      )}
      {result && <ResultBlock result={result} px={px} />}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="num truncate">{value}</dd>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="label">{label}</span>
      <span className={`num font-semibold ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

function ResultBlock({ result, px }: { result: AutonomousAnalysisResult; px: (v: number | null | undefined) => string }) {
  const r = result.riskValidation;
  const t = result.proposedTrade;
  const final = result.finalDecision;
  const notes = r ? [...r.warnings, ...r.discrepancies] : [];
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-2" data-testid="analysis-result">
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <div>
          <Row label="AI decision" value={result.aiDecision ?? "NO ANSWER"} tone={result.aiDecision === "TRADE" ? "text-pass" : "text-muted"} />
          {result.setupQuality !== null && <Row label="Setup quality" value={`${result.setupQuality} / 100`} />}
          {t && (
            <>
              <Row label="Entry" value={px(t.entry)} />
              <Row label="Stop loss" value={px(t.stopLoss)} />
              <Row label="Take profit" value={px(t.takeProfit)} />
            </>
          )}
        </div>
        <div>
          {r && (
            <>
              <Row label="R:R (calculated)" value={r.calculatedRR === null ? "—" : `1 : ${r.calculatedRR.toFixed(2)}`} />
              <Row
                label="Risk (calculated)"
                value={r.calculatedRiskPercent === null ? "—" : `${r.calculatedRiskPercent.toFixed(2)}% · ${formatMoney(r.calculatedRiskAmount ?? 0, r.accountCurrency)}`}
              />
              <Row label="Size (calculated)" value={r.positionSizeLots === null ? "—" : `${r.positionSizeLots.toFixed(2)} lots`} />
              <Row label="Risk validation" value={r.passed ? "PASSED" : "FAILED"} tone={r.passed ? "text-pass" : "text-block"} />
            </>
          )}
          <Row label="Final analysis decision" value={final === "TRADE" ? "TRADE PROPOSAL" : "NO TRADE"} tone={final === "TRADE" ? "text-pass" : "text-warn"} />
        </div>
      </div>
      <p className={`text-[12px] ${final === "TRADE" ? "text-muted" : "text-warn"}`}>{result.finalReason}</p>
      {r && r.failures.length > 0 && (
        <ul className="text-[12px] text-block">
          {r.failures.map((f) => (
            <li key={f}>✕ {f}</li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="text-[11.5px] text-warn">
          {notes.map((f) => (
            <li key={f}>⚠ {f}</li>
          ))}
        </ul>
      )}
      {result.analysis && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-muted">AI reasoning</summary>
          <p className="mt-1">{result.analysis.summary}</p>
          {(
            [
              ["Supporting", result.analysis.positiveFactors],
              ["Warnings", result.analysis.warnings],
              ["Contradicting", result.analysis.contradictingFactors],
              ["Invalidation", result.analysis.invalidation],
            ] as const
          ).map(([label, items]) =>
            items.length ? (
              <div key={label} className="mt-1">
                <span className="label">{label}</span>
                <ul className="list-disc pl-4 text-muted">
                  {items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </details>
      )}
      <p className="text-[10.5px] text-faint">
        Setup quality is a heuristic assessment of the setup, not a probability of profit. {result.model}
        {result.servedBy && result.servedBy !== result.model ? ` (answered by ${result.servedBy})` : ""} · {result.promptVersion}
        {result.cached ? " · reused an earlier identical analysis" : ""} · No order has been or will be placed.
      </p>
    </section>
  );
}
