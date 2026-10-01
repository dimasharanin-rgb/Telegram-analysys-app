import { Link } from "react-router";
import { api } from "@/lib/apiClient";
import { formatMoney } from "@/lib/format";
import { useAsync } from "@/hooks/useAsync";
import { ScoreOutcomeChart } from "@/components/dashboard/ScoreOutcomeChart";
import { Metric } from "@/components/ui/Metric";
import { Notice, Spinner } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { DirectionTag, VerdictBadge } from "@/components/ui/VerdictBadge";

export function DashboardPage() {
  const { data, error, loading } = useAsync(() => api.dashboard(), []);
  if (error) return <Notice tone="block">{error.message}</Notice>;
  if (!data) return loading ? <Spinner label="Loading…" /> : null;

  const { account, limits, stats, currency } = data;
  const money = (v: number, sign = false) => formatMoney(v, currency, { sign });
  const dailyRemaining = Math.max(0, limits.dailyLossRemaining);
  const ddRemaining = Math.max(0, limits.drawdownRemaining);
  const maxPositions = limits.positionsRemaining + account.openPositions;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Account balance" value={money(account.balance)} sub={`Initial ${money(account.initialBalance)} · ${account.source === "JOURNAL" ? "from journal" : "manual"}`} />
        <Metric
          label="Today's P/L"
          value={money(account.todayRealizedPnl, true)}
          tone={account.todayRealizedPnl > 0 ? "pass" : account.todayRealizedPnl < 0 ? "block" : "default"}
          sub="Realised, closed trades"
        />
        <Metric
          label="Daily loss remaining"
          value={money(dailyRemaining)}
          bar={limits.dailyLossLimit > 0 ? dailyRemaining / limits.dailyLossLimit : null}
          tone={dailyRemaining <= 0 ? "block" : "default"}
          sub={`Limit ${money(limits.dailyLossLimit)}${account.openRisk > 0 ? ` · open risk ${money(account.openRisk)}` : ""}`}
        />
        <Metric
          label="Max drawdown remaining"
          value={money(ddRemaining)}
          bar={limits.drawdownLimit > 0 ? ddRemaining / limits.drawdownLimit : null}
          tone={ddRemaining <= 0 ? "block" : "default"}
          sub={`Floor ${money(limits.drawdownFloor)}`}
        />
        <Metric
          label="Open positions"
          value={`${account.openPositions} / ${maxPositions}`}
          tone={limits.positionsRemaining <= 0 ? "warn" : "default"}
          sub={account.openRisk > 0 ? `Risk ${money(account.openRisk)}` : "None at risk"}
        />
        <Metric label="Trades analysed" value={stats.analyses} sub={`${stats.blocked} blocked by rules`} />
      </div>

      <Panel title="Journal statistics">
        <div className="grid grid-cols-3 gap-x-6 gap-y-2 sm:grid-cols-5 xl:grid-cols-9">
          <Stat label="Analyses" value={stats.analyses} />
          <Stat label="Accepted" value={stats.accepted} tone="text-pass" />
          <Stat label="Caution" value={stats.caution} tone="text-warn" />
          <Stat label="Rejected" value={stats.rejected} tone="text-block" />
          <Stat label="Blocked" value={stats.blocked} tone="text-block" />
          <Stat label="Wins" value={stats.wins} />
          <Stat label="Losses" value={stats.losses} />
          <Stat label="Avg AI score" value={stats.averageAiScore ?? "—"} />
          <Stat label="Avg R" value={stats.averageR === null ? "—" : stats.averageR.toFixed(2)} />
        </div>
      </Panel>

      <ScoreOutcomeChart data={data.scoreVsOutcome} />

      <Panel title="Recent analyses" actions={<Link to="/journal" className="text-[12px] text-accent hover:underline">Open journal</Link>} bodyClassName="p-0">
        {data.recent.length === 0 ? (
          <p className="p-3 text-muted">
            Nothing analysed yet. <Link to="/analyze" className="text-accent hover:underline">Analyze a trade</Link>.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.recent.map((e) => (
              <li key={e.id}>
                <Link to={`/journal?entry=${e.id}`} className="flex items-center gap-3 px-3 py-1.5 text-[12.5px] hover:bg-panel-2">
                  <span className="num w-32 text-muted">{new Date(e.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                  <span className="num w-16 font-medium">{e.pair}</span>
                  <span className="w-12">
                    <DirectionTag direction={e.direction} />
                  </span>
                  <VerdictBadge verdict={e.finalVerdict} />
                  <span className="num ml-auto text-muted">{e.aiScore === null ? "" : `${e.aiScore}/100`}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`num text-[16px] font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
