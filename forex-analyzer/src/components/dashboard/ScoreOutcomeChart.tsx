import { CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { ScoreOutcomePoint, ScoreVsOutcome } from "@/types/dashboard";
import { Panel } from "@/components/ui/Panel";

// Result is a status, so it uses the status colours, with a distinct marker shape per result as a second encoding.
const SERIES: { result: ScoreOutcomePoint["result"]; color: string; shape: "circle" | "cross" | "diamond" }[] = [
  { result: "WIN", color: "#2ebd85", shape: "circle" },
  { result: "LOSS", color: "#f0524f", shape: "cross" },
  { result: "BREAKEVEN", color: "#8b95a4", shape: "diamond" },
];

/**
 * AI setup score against recorded outcomes. Until the sample reaches the
 * minimum it shows only progress, so no pattern is implied from a handful of trades.
 */
export function ScoreOutcomeChart({ data }: { data: ScoreVsOutcome }) {
  if (!data.sufficient) {
    const share = Math.min(1, data.sampleSize / data.minimumSample);
    return (
      <Panel title="AI score vs actual outcome">
        <p className="text-[12.5px]">
          Not enough data yet: <span className="num font-semibold">{data.sampleSize}</span> of{" "}
          <span className="num">{data.minimumSample}</span> closed, scored trades recorded.
        </p>
        <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded bg-line" aria-hidden>
          <div className="h-full bg-accent" style={{ width: `${share * 100}%` }} />
        </div>
        <p className="mt-2 text-[11.5px] text-faint">
          Record outcomes (win, loss, breakeven with P/L) in the Journal. The comparison appears once {data.minimumSample} exist. Until
          then no conclusion about the score's usefulness is drawn.
        </p>
      </Panel>
    );
  }

  const points = data.points.filter((p) => p.rMultiple !== null);
  return (
    <Panel title={`AI score vs actual outcome · n = ${data.sampleSize}`}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <div className="h-72" role="img" aria-label="Scatter of AI setup score against R multiple, by result">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="#1d242e" />
              <XAxis type="number" dataKey="score" name="AI score" domain={[0, 100]} tick={{ fill: "#8b95a4", fontSize: 11 }} stroke="#2a3340" label={{ value: "AI setup score", fill: "#8b95a4", fontSize: 11, position: "insideBottom", offset: -4 }} />
              <YAxis type="number" dataKey="rMultiple" name="R" tick={{ fill: "#8b95a4", fontSize: 11 }} stroke="#2a3340" width={40} />
              <ReferenceLine y={0} stroke="#5c6675" />
              <Tooltip
                cursor={{ stroke: "#2a3340" }}
                contentStyle={{ background: "#141922", border: "1px solid #2a3340", fontSize: 12, color: "#d6dce4" }}
                formatter={(value: unknown, name: unknown) => [String(value), String(name)]}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#8b95a4" }} />
              {SERIES.map((s) => (
                <Scatter key={s.result} name={s.result} data={points.filter((p) => p.result === s.result)} fill={s.color} shape={s.shape} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-col gap-2">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="label border-b border-line text-left">
                <th className="py-1 font-medium">Score</th>
                <th className="py-1 text-right font-medium">Trades</th>
                <th className="py-1 text-right font-medium">Wins</th>
                <th className="py-1 text-right font-medium">Avg R</th>
              </tr>
            </thead>
            <tbody>
              {data.buckets.map((b) => (
                <tr key={b.label} className="border-b border-line last:border-0">
                  <td className="num py-1">{b.label}</td>
                  <td className="num py-1 text-right">{b.trades}</td>
                  <td className="num py-1 text-right">{b.trades ? `${b.wins} (${Math.round((b.wins / b.trades) * 100)}%)` : "—"}</td>
                  <td className="num py-1 text-right">{b.averageR === null ? "—" : b.averageR.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rankCorrelation !== null && (
            <p className="text-[12px]">
              Rank correlation (score vs R): <span className="num font-semibold">{data.rankCorrelation.toFixed(2)}</span>
            </p>
          )}
          <p className="text-[11px] text-faint">
            Descriptive figures from your own journal, not a significance test. Small samples, changing markets and selection
            (which trades you took) can produce patterns that do not persist.
          </p>
        </div>
      </div>
    </Panel>
  );
}
