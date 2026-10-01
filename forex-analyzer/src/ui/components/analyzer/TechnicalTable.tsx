import type { MarketCheck, AnalysisSnapshot } from "@/shared/types/analysis";
import type { InstrumentSpec } from "@/shared/types/instrument";
import type { StructureBias } from "@/shared/types/technical";
import { formatPrice } from "@/shared/instruments";
import { Panel } from "@/ui/components/ui/Panel";
import { CheckList } from "@/ui/components/analyzer/CheckList";

const BIAS_COLOR: Record<StructureBias, string> = {
  BULLISH: "text-long",
  BEARISH: "text-short",
  RANGE: "text-warn",
  UNCLEAR: "text-muted",
};

/** Deterministic multi-timeframe metrics that were given to the AI. */
export function TechnicalTable({ market, checks, instrument }: { market: AnalysisSnapshot; checks: MarketCheck[]; instrument: InstrumentSpec | undefined }) {
  const px = (v: number | null) => (v === null ? "—" : formatPrice(v, instrument));
  const spreadPips = market.price.spread !== null && instrument ? (market.price.spread / instrument.pipSize).toFixed(1) : null;
  return (
    <Panel title="Market & technicals" bodyClassName="p-0">
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line px-3 py-2 text-[12px]">
        <span>
          <span className="text-muted">Price </span>
          <span className="num">{px(market.price.mid)}</span>
        </span>
        <span>
          <span className="text-muted">Bid/Ask </span>
          <span className="num">
            {market.price.bid === null ? "—" : px(market.price.bid)} / {market.price.ask === null ? "—" : px(market.price.ask)}
          </span>
        </span>
        <span>
          <span className="text-muted">Spread </span>
          <span className="num">{spreadPips === null ? "not reported" : `${spreadPips} pips`}</span>
        </span>
        <span className="text-faint">
          {market.providerName} · {new Date(market.price.timestamp).toISOString().slice(11, 19)} UTC (price time)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="label border-b border-line text-left">
              <th className="px-3 py-1.5 font-medium">TF</th>
              <th className="px-2 py-1.5 font-medium">Structure</th>
              <th className="px-2 py-1.5 font-medium">EMA</th>
              <th className="px-2 py-1.5 text-right font-medium">RSI</th>
              <th className="px-2 py-1.5 text-right font-medium">ATR</th>
              <th className="px-2 py-1.5 font-medium">Vol</th>
              <th className="px-2 py-1.5 text-right font-medium">Support</th>
              <th className="px-3 py-1.5 text-right font-medium">Resistance</th>
            </tr>
          </thead>
          <tbody>
            {market.timeframes.map((t) => (
              <tr key={t.timeframe} className="border-b border-line last:border-0" title={t.structure.reason}>
                <td className="num px-3 py-1.5 font-semibold">{t.timeframe}</td>
                <td className={`px-2 py-1.5 font-medium ${BIAS_COLOR[t.structure.bias]}`}>{t.structure.bias}</td>
                <td className="px-2 py-1.5 text-muted">{t.emaTrend}</td>
                <td className="num px-2 py-1.5 text-right">{t.indicators.rsi14 === null ? "—" : t.indicators.rsi14.toFixed(1)}</td>
                <td className="num px-2 py-1.5 text-right">{px(t.indicators.atr14)}</td>
                <td className="px-2 py-1.5 text-muted">{t.indicators.volatility}</td>
                <td className="num px-2 py-1.5 text-right">{t.support[0] ? px(t.support[0].price) : "—"}</td>
                <td className="num px-3 py-1.5 text-right">{t.resistance[0] ? px(t.resistance[0].price) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {checks.length > 0 && (
        <div className="border-t border-line px-3 py-1">
          <CheckList checks={checks} />
        </div>
      )}
    </Panel>
  );
}
