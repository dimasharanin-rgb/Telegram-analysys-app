import type { AnalysisResult } from "@/types/analysis";
import { formatLots, formatMoney, formatPct, formatRR } from "@/lib/format";
import { DirectionTag, VERDICT_COLOR } from "@/components/ui/VerdictBadge";

const HEADLINE_BG: Record<string, string> = {
  ACCEPTABLE: "border-pass/40 bg-pass/[0.06]",
  CAUTION: "border-warn/40 bg-warn/[0.06]",
  REJECT: "border-block/40 bg-block/[0.06]",
  BLOCKED: "border-block/60 bg-block/[0.09]",
  UNAVAILABLE: "border-line-strong bg-panel-2",
};

/** The large result card: final verdict, setup score with its caveat, and the deterministic money figures. */
export function VerdictCard({ result }: { result: AnalysisResult }) {
  const { decision, trade, risk, ai } = result;
  const calc = risk.calculation;
  const ccy = calc?.accountCurrency ?? result.settings.currency;
  const verdict = decision.finalVerdict;

  return (
    <section className={`flex h-full flex-col gap-3 rounded-md border p-4 ${HEADLINE_BG[verdict]}`} aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
        <span className="num">
          <span className="font-semibold text-fg">{trade.pair}</span> · <DirectionTag direction={trade.direction} /> · {trade.timeframe}
        </span>
        <span>{new Date(result.createdAt).toLocaleString()}</span>
      </div>

      <div>
        <div className={`text-[30px] font-bold leading-none tracking-wide ${VERDICT_COLOR[verdict]}`}>{decision.headline}</div>
        {decision.capped && decision.aiVerdict && (
          <p className="mt-1 text-[12px] text-warn">
            AI verdict {decision.aiVerdict}, capped at CAUTION by your application rules.
          </p>
        )}
        {verdict === "BLOCKED" && <p className="mt-1 text-[12px] text-muted">Claude was not consulted. Account rules are enforced by the application, not the AI.</p>}
        {verdict === "UNAVAILABLE" && <p className="mt-1 text-[12px] text-muted">No verdict is shown without verified market data and a valid AI response.</p>}
      </div>

      {ai && (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <div className="shrink-0">
            <div className="label whitespace-nowrap">Setup quality</div>
            <div className="num whitespace-nowrap text-[26px] font-semibold leading-tight">
              {ai.assessment.setupQuality}
              <span className="text-[15px] text-muted"> / 100</span>
            </div>
          </div>
          <p className="min-w-[180px] flex-1 pb-1 text-[11px] leading-snug text-faint">
            A heuristic assessment of the supplied setup. It is not a probability of profit or of the trade succeeding.
          </p>
        </div>
      )}

      {calc && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-line pt-2 text-[12.5px] sm:grid-cols-3">
          <Row label="R:R" value={formatRR(calc.riskReward)} />
          <Row label="Risk" value={formatPct(calc.riskPercent)} />
          <Row label="Size" value={formatLots(calc.positionSize)} />
          <Row label="Risk $" value={formatMoney(calc.riskAmount, ccy)} />
          <Row label="Reward $" value={formatMoney(calc.rewardAmount, ccy)} />
          <Row label="Rules" value={risk.status} />
        </div>
      )}

      {decision.reasons.length > 0 && (
        <div className="border-t border-line pt-2">
          <div className="label mb-1">
            {verdict === "BLOCKED"
              ? "Why it is blocked"
              : verdict === "UNAVAILABLE"
                ? "Why"
                : decision.capped
                  ? "Capped by your rules"
                  : "Also flagged by your rules"}
          </div>
          <ul className="flex flex-col gap-1 text-[12px]">
            {decision.reasons.map((r) => (
              <li key={r} className={verdict === "BLOCKED" ? "text-block" : verdict === "UNAVAILABLE" ? "text-muted" : "text-warn"}>
                {verdict === "BLOCKED" ? "✕ " : "• "}
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ai && (
        <div className="mt-auto flex flex-wrap gap-x-3 text-[10.5px] text-faint">
          <span>{ai.info.provider === "mock" ? "MOCK analyst (rules, not Claude)" : `Claude · ${ai.info.servedBy}`}</span>
          <span>{(ai.info.durationMs / 1000).toFixed(1)}s</span>
          {result.market?.isMock && <span>synthetic market data</span>}
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 whitespace-nowrap">
      <span className="text-muted">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
