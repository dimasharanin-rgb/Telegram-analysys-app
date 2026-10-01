import { useEffect, useState } from "react";
import type { TimeframeAnalysis } from "@/shared/types/technical";
import { formatPrice, getInstrument } from "@/shared/instruments";
import { api } from "@/ui/lib/apiClient";
import { useLiveFeed } from "@/ui/hooks/useLiveFeed";
import { Panel } from "@/ui/components/ui/Panel";

const REFRESH_MS = 60_000;
const TONE: Record<string, string> = { BULLISH: "text-long", BEARISH: "text-short", RANGE: "text-warn", MIXED: "text-warn" };

/**
 * Deterministic market facts per timeframe, from the same engine the analysis
 * uses. Informational only: no buy/sell wording, no probabilities.
 */
export function MarketContext() {
  const feed = useLiveFeed();
  const [rows, setRows] = useState<TimeframeAnalysis[]>([]);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const mode = feed.status?.mode;
  const instrument = getInstrument(feed.symbol);
  const px = (v: number | null | undefined) => (v == null ? "—" : formatPrice(v, instrument));

  useEffect(() => {
    let cancelled = false;
    api
      .marketContext(feed.symbol)
      .then((r) => {
        if (cancelled) return;
        setRows(r.timeframes.filter((t) => t.timeframe !== "M5"));
        setAsOf(r.asOf);
        setError(r.stale ? `STALE DATA: ${r.staleReasons[0] ?? ""}` : null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRows([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    const t = setTimeout(() => setNonce((n) => n + 1), REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [feed.symbol, mode, nonce]);

  return (
    <Panel
      title="Market context"
      actions={<span className="text-[10.5px] text-faint">{asOf ? `as of ${new Date(asOf).toISOString().slice(11, 19)} UTC · ` : ""}facts, not signals</span>}
      bodyClassName="overflow-x-auto p-0"
    >
      {error && <p className="px-3 py-2 text-[12px] text-warn">{error}</p>}
      {rows.length > 0 && (
        <table className="w-full min-w-[760px] text-[12px]" aria-label="Market context">
          <thead>
            <tr className="label border-b border-line text-left">
              <th className="px-3 py-1.5 font-medium">TF</th>
              <th className="px-2 py-1.5 font-medium">Trend</th>
              <th className="px-2 py-1.5 font-medium">Structure</th>
              <th className="px-2 py-1.5 font-medium">Momentum</th>
              <th className="px-2 py-1.5 font-medium">Volatility</th>
              <th className="px-2 py-1.5 text-right font-medium">EMA20</th>
              <th className="px-2 py-1.5 text-right font-medium">EMA50</th>
              <th className="px-2 py-1.5 text-right font-medium">EMA200</th>
              <th className="px-2 py-1.5 text-right font-medium">Nearest support</th>
              <th className="px-3 py-1.5 text-right font-medium">Nearest resistance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.timeframe} className="border-b border-line last:border-0" title={t.structure.reason}>
                <td className="num px-3 py-1.5 font-semibold">{t.timeframe}</td>
                <td className={`px-2 py-1.5 ${TONE[t.trend.direction] ?? "text-muted"}`}>{t.trend.direction}</td>
                <td className="px-2 py-1.5">
                  <span className={TONE[t.structure.bias] ?? "text-muted"}>{t.structure.bias}</span>{" "}
                  <span className="num text-faint">{t.structure.sequence.slice(-2).join(" / ")}</span>
                </td>
                <td className="px-2 py-1.5 text-muted">
                  {t.momentum.state} <span className="num text-faint">{t.momentum.rsi14?.toFixed(1) ?? ""}</span>
                </td>
                <td className="px-2 py-1.5 text-muted">
                  {t.volatility.state} <span className="num text-faint">ATR {px(t.volatility.atr14)}</span>
                </td>
                <td className="num px-2 py-1.5 text-right">{px(t.indicators.ema20)}</td>
                <td className="num px-2 py-1.5 text-right">{px(t.indicators.ema50)}</td>
                <td className="num px-2 py-1.5 text-right">{px(t.indicators.ema200)}</td>
                <td className="num px-2 py-1.5 text-right">{px(t.support[0]?.price)}</td>
                <td className="num px-3 py-1.5 text-right">{px(t.resistance[0]?.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
