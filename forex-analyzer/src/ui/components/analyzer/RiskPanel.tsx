import type { RiskReport } from "@/shared/types/risk";
import { formatLots, formatMoney, formatPct, formatPips, formatRR } from "@/shared/format";
import { KV } from "@/ui/components/ui/Metric";
import { Notice, Spinner } from "@/ui/components/ui/Notice";
import { Panel } from "@/ui/components/ui/Panel";
import { CheckList } from "@/ui/components/analyzer/CheckList";

interface RiskPanelProps {
  report: RiskReport | null;
  loading: boolean;
  error: string | null;
  incomplete: boolean;
}

/** Live output of the deterministic risk engine. Shown before (and independently of) any AI analysis. */
export function RiskPanel({ report, loading, error, incomplete }: RiskPanelProps) {
  const calc = report?.calculation ?? null;
  const ccy = calc?.accountCurrency ?? "USD";
  const blocked = report?.status === "BLOCKED";

  return (
    <Panel
      title="Risk engine · funded-account check"
      actions={loading ? <Spinner /> : report ? <StatusPill status={report.status} /> : null}
      className="h-full"
    >
      {incomplete && !report ? (
        <p className="text-muted">Enter pair, direction, entry, stop loss and take profit to calculate risk.</p>
      ) : error ? (
        <Notice tone="block">{error}</Notice>
      ) : report ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,0.8fr)_1.2fr]">
          <div className="flex flex-col gap-3">
            {calc ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Big label="R:R" value={formatRR(calc.riskReward)} />
                  <Big label="Risk" value={formatPct(calc.riskPercent)} tone={blocked ? "text-block" : undefined} />
                  <Big label="Risk $" value={formatMoney(calc.riskAmount, ccy)} />
                  <Big label="Reward $" value={formatMoney(calc.rewardAmount, ccy)} />
                </div>
                <div className="rounded border border-line px-2.5 py-1.5 text-[12px]">
                  <KV
                    label={calc.positionSizeSource === "USER" ? "Your position size" : "Suggested position size"}
                    value={calc.suggestedPositionSize > 0 || calc.positionSizeSource === "USER" ? formatLots(calc.positionSize) : "none fits"}
                  />
                  {calc.positionSizeSource === "USER" && (
                    <KV label="Risk-limited size" value={calc.suggestedPositionSize > 0 ? formatLots(calc.suggestedPositionSize) : "none fits"} />
                  )}
                  <KV label="Stop distance" value={formatPips(calc.riskPips)} />
                  <KV label="Target distance" value={formatPips(calc.rewardPips)} />
                  <KV label="Pip value / lot" value={formatMoney(calc.pipValuePerLot, ccy)} />
                  <KV label="Units" value={calc.units.toLocaleString("en-US")} />
                </div>
              </>
            ) : (
              <p className="text-muted">Risk could not be calculated for this input.</p>
            )}
            <div className="rounded border border-line px-2.5 py-1.5 text-[12px]">
              <KV label="Balance" value={formatMoney(report.account.balance, ccy)} />
              <KV label="Daily loss remaining" value={formatMoney(Math.max(0, report.limits.dailyLossRemaining), ccy)} />
              <KV label="Drawdown remaining" value={formatMoney(Math.max(0, report.limits.drawdownRemaining), ccy)} />
              <KV label="Max risk per trade" value={formatMoney(report.limits.maxRiskAmount, ccy)} />
              <p className="mt-1 text-[10.5px] text-faint">Account figures: {report.account.source === "JOURNAL" ? "from the journal" : "entered manually"}.</p>
            </div>
          </div>
          <div>
            {blocked && (
              <Notice tone="block" className="mb-2 font-semibold">
                TRADE BLOCKED — it breaks a hard rule below. It will not be sent for AI analysis.
              </Notice>
            )}
            <CheckList checks={report.checks} />
          </div>
        </div>
      ) : (
        <Spinner label="Calculating…" />
      )}
    </Panel>
  );
}

function Big({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-line bg-panel-2 px-2.5 py-1.5">
      <div className="label">{label}</div>
      <div className={`num text-[17px] font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: RiskReport["status"] }) {
  const cls =
    status === "PASS" ? "border-pass/40 text-pass" : status === "WARNING" ? "border-warn/40 text-warn" : "border-block/50 bg-block/10 text-block";
  return <span className={`rounded border px-1.5 py-px text-[10.5px] font-semibold ${cls}`}>{status}</span>;
}
