import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { PriceLevel } from "@/types/technical";
import type { Candle } from "@/types/market";
import type { Timeframe, TradeInput } from "@/types/trade";
import { emaLine } from "@/lib/chartData";
import { getInstrument } from "@/lib/instruments";

const COLORS = {
  surface: "#0f131a",
  grid: "#161c25",
  axis: "#1d242e",
  text: "#8b95a4",
  up: "#2ebd85",
  down: "#f0524f",
  entry: "#4c8dff",
  stop: "#f0524f",
  target: "#2ebd85",
  price: "#d6dce4",
  ema20: "#d95926",
  ema50: "#9085e9",
  level: "#5c6675",
};

const VISIBLE_BARS = 120;

interface TradeChartProps {
  candles: Partial<Record<Timeframe, Candle[]>>;
  initialTimeframe: Timeframe;
  trade: Pick<TradeInput, "pair" | "entry" | "stopLoss" | "takeProfit" | "direction">;
  currentPrice?: number | null;
  levels?: Partial<Record<Timeframe, { support: PriceLevel[]; resistance: PriceLevel[] }>>;
  height?: number;
}

/**
 * Candlesticks with the trade drawn on top: ENTRY, SL and TP as labelled price
 * lines, the current price as a dotted line, EMA 20/50 overlays and (optionally)
 * nearby support/resistance. The scale always includes entry, stop and target.
 */
export function TradeChart({ candles, initialTimeframe, trade, currentPrice, levels, height = 380 }: TradeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timeframes = useMemo(() => (Object.keys(candles) as Timeframe[]).filter((tf) => (candles[tf]?.length ?? 0) > 0), [candles]);
  const [tf, setTf] = useState<Timeframe>(timeframes.includes(initialTimeframe) ? initialTimeframe : (timeframes[0] ?? initialTimeframe));
  const [showEma, setShowEma] = useState(true);
  const [showLevels, setShowLevels] = useState(true);
  const instrument = getInstrument(trade.pair);
  const data = candles[tf] ?? [];

  useEffect(() => {
    const el = containerRef.current;
    if (!el || data.length === 0) return;
    const precision = instrument?.pricePrecision ?? 5;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: COLORS.surface }, textColor: COLORS.text, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.axis },
      timeScale: { borderColor: COLORS.axis, timeVisible: true, secondsVisible: false, rightOffset: 6 },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const tradeLevels = [trade.entry, trade.stopLoss, trade.takeProfit];
    const series: ISeriesApi<"Candlestick"> = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: currentPrice == null,
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const res = original();
        if (!res) return res;
        return {
          ...res,
          priceRange: {
            minValue: Math.min(res.priceRange.minValue, ...tradeLevels),
            maxValue: Math.max(res.priceRange.maxValue, ...tradeLevels),
          },
        };
      },
    });
    series.setData(data.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));

    if (showEma) {
      for (const [period, color] of [
        [20, COLORS.ema20],
        [50, COLORS.ema50],
      ] as const) {
        const line = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: { type: "price", precision, minMove: 10 ** -precision },
        });
        line.setData(emaLine(data, period).map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
      }
    }

    const lines: IPriceLine[] = [];
    const add = (price: number, color: string, title: string, style: LineStyle, width: 1 | 2 = 1) =>
      lines.push(series.createPriceLine({ price, color, title, lineStyle: style, lineWidth: width, axisLabelVisible: true }));
    add(trade.takeProfit, COLORS.target, "TP", LineStyle.Dashed, 2);
    add(trade.entry, COLORS.entry, "ENTRY", LineStyle.Solid, 2);
    add(trade.stopLoss, COLORS.stop, "SL", LineStyle.Dashed, 2);
    if (currentPrice != null) add(currentPrice, COLORS.price, "PRICE", LineStyle.Dotted, 1);

    const lv = levels?.[tf];
    if (showLevels && lv) {
      for (const l of lv.support.slice(0, 2)) {
        lines.push(series.createPriceLine({ price: l.price, color: COLORS.level, title: "S", lineStyle: LineStyle.SparseDotted, lineWidth: 1, axisLabelVisible: false }));
      }
      for (const l of lv.resistance.slice(0, 2)) {
        lines.push(series.createPriceLine({ price: l.price, color: COLORS.level, title: "R", lineStyle: LineStyle.SparseDotted, lineWidth: 1, axisLabelVisible: false }));
      }
    }

    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - VISIBLE_BARS), to: data.length + 5 });
    return () => chart.remove();
  }, [data, tf, trade.entry, trade.stopLoss, trade.takeProfit, currentPrice, levels, showEma, showLevels, instrument]);

  if (timeframes.length === 0) return <div className="flex h-40 items-center justify-center text-muted">No candle data.</div>;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-1.5 text-[11.5px]">
        <div className="flex gap-0.5" role="tablist" aria-label="Chart timeframe">
          {timeframes.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === tf}
              onClick={() => setTf(t)}
              className={`num rounded px-1.5 py-0.5 ${t === tf ? "bg-line-strong text-fg" : "text-muted hover:text-fg"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <Legend color={COLORS.entry} label="Entry" solid />
        <Legend color={COLORS.stop} label="SL" />
        <Legend color={COLORS.target} label="TP" />
        {currentPrice != null && <Legend color={COLORS.price} label="Price" dotted />}
        <label className="ml-auto flex items-center gap-1 text-muted">
          <input type="checkbox" checked={showEma} onChange={(e) => setShowEma(e.target.checked)} />
          <span>
            EMA <span style={{ color: COLORS.ema20 }}>20</span>/<span style={{ color: COLORS.ema50 }}>50</span>
          </span>
        </label>
        {levels && (
          <label className="flex items-center gap-1 text-muted">
            <input type="checkbox" checked={showLevels} onChange={(e) => setShowLevels(e.target.checked)} />
            S/R
          </label>
        )}
      </div>
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}

function Legend({ color, label, solid, dotted }: { color: string; label: string; solid?: boolean; dotted?: boolean }) {
  return (
    <span className="flex items-center gap-1 text-muted">
      <span
        aria-hidden
        className="inline-block w-4"
        style={{ borderTop: `2px ${solid ? "solid" : dotted ? "dotted" : "dashed"} ${color}` }}
      />
      {label}
    </span>
  );
}
