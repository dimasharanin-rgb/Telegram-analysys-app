import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Quote } from "@/shared/types/market";
import type { PriceLevel } from "@/shared/types/technical";
import type { Timeframe } from "@/shared/types/trade";
import { applyQuoteToCandles } from "@/shared/candles";
import { getInstrument } from "@/shared/instruments";
import { ema } from "@/technical/indicators";

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
  ema200: "#3987e5",
  level: "#5c6675",
};

const VISIBLE_BARS = 120;

export interface TradeLevels {
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
}

interface TradeChartProps {
  symbol: string;
  timeframe: Timeframe;
  timeframes: readonly Timeframe[];
  onTimeframeChange: (tf: Timeframe) => void;
  candles: Candle[];
  /** Live price: updates the forming candle and the PRICE line in place. */
  liveQuote?: Quote | null;
  /** Static current price (stored analyses). */
  currentPrice?: number | null;
  trade?: TradeLevels;
  levels?: { support: PriceLevel[]; resistance: PriceLevel[] };
  live?: boolean;
  /** Synthetic data: the live badge says SIMULATED instead of LIVE. */
  simulated?: boolean;
  loading?: boolean;
  height?: number;
}

const sec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const toBar = (c: Candle) => ({ time: sec(c.timestamp), open: c.open, high: c.high, low: c.low, close: c.close });

function emaPoints(candles: Candle[], period: number) {
  const values = ema(candles.map((c) => c.close), period);
  return values.flatMap((v, i) => (v === null ? [] : [{ time: sec(candles[i]!.timestamp), value: v }]));
}

/**
 * Candlestick chart with the proposed trade drawn on it: ENTRY, SL and TP as
 * labelled lines, the current price dotted, EMA 20/50 (and optionally 200)
 * and nearby support/resistance. Live ticks update the forming candle in
 * place, so zoom and scroll survive.
 */
export function TradeChart(props: TradeChartProps) {
  const { symbol, timeframe, timeframes, onTimeframeChange, candles, liveQuote, currentPrice, trade, levels, live, simulated, loading, height = 400 } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaRefs = useRef<ISeriesApi<"Line">[]>([]);
  const linesRef = useRef<IPriceLine[]>([]);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const barsRef = useRef<Candle[]>([]);
  const tradeRef = useRef<number[]>([]);
  const [showEma, setShowEma] = useState(true);
  const [showEma200, setShowEma200] = useState(false);
  const [showLevels, setShowLevels] = useState(true);
  const instrument = getInstrument(symbol);
  const precision = instrument?.pricePrecision ?? 5;

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: COLORS.surface }, textColor: COLORS.text, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.axis },
      timeScale: { borderColor: COLORS.axis, timeVisible: true, secondsVisible: false, rightOffset: 6 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      borderVisible: false,
      priceLineVisible: false,
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const res = original();
        const extra = tradeRef.current;
        if (!res || extra.length === 0) return res;
        return { ...res, priceRange: { minValue: Math.min(res.priceRange.minValue, ...extra), maxValue: Math.max(res.priceRange.maxValue, ...extra) } };
      },
    });
    emaRefs.current = [COLORS.ema20, COLORS.ema50, COLORS.ema200].map((color) =>
      chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
    );
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLineRef.current = null;
      linesRef.current = [];
    };
  }, []);

  // Price format follows the instrument.
  useEffect(() => {
    const format = { type: "price" as const, precision, minMove: 10 ** -precision };
    seriesRef.current?.applyOptions({ priceFormat: format });
    for (const l of emaRefs.current) l.applyOptions({ priceFormat: format });
  }, [precision]);

  // Full data load: new symbol, timeframe or fetch.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    barsRef.current = candles;
    series.setData(candles.map(toBar));
    [20, 50, 200].forEach((period, i) => emaRefs.current[i]?.setData(emaPoints(candles, period)));
    chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - VISIBLE_BARS), to: candles.length + 5 });
  }, [candles, symbol, timeframe]);

  useEffect(() => {
    emaRefs.current[0]?.applyOptions({ visible: showEma });
    emaRefs.current[1]?.applyOptions({ visible: showEma });
    emaRefs.current[2]?.applyOptions({ visible: showEma200 });
  }, [showEma, showEma200]);

  // Live tick: update the forming bar and the price line without redrawing everything.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !liveQuote || liveQuote.symbol !== symbol || barsRef.current.length === 0) return;
    const next = applyQuoteToCandles(barsRef.current, liveQuote, timeframe);
    barsRef.current = next;
    series.update(toBar(next[next.length - 1]!));
  }, [liveQuote, symbol, timeframe]);

  const shownPrice = liveQuote && liveQuote.symbol === symbol ? liveQuote.mid : (currentPrice ?? null);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (shownPrice == null) {
      if (priceLineRef.current) series.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
      return;
    }
    if (priceLineRef.current) priceLineRef.current.applyOptions({ price: shownPrice });
    else priceLineRef.current = series.createPriceLine({ price: shownPrice, color: COLORS.price, title: "PRICE", lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true });
  }, [shownPrice]);

  // Trade lines and levels.
  const entry = trade?.entry ?? null;
  const stop = trade?.stopLoss ?? null;
  const target = trade?.takeProfit ?? null;
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const l of linesRef.current) series.removePriceLine(l);
    linesRef.current = [];
    const valid = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0;
    tradeRef.current = [entry, stop, target].filter(valid);
    const add = (price: number | null, color: string, title: string, style: LineStyle, width: 1 | 2, axis = true) => {
      if (valid(price)) linesRef.current.push(series.createPriceLine({ price, color, title, lineStyle: style, lineWidth: width, axisLabelVisible: axis }));
    };
    add(target, COLORS.target, "TP", LineStyle.Dashed, 2);
    add(entry, COLORS.entry, "ENTRY", LineStyle.Solid, 2);
    add(stop, COLORS.stop, "SL", LineStyle.Dashed, 2);
    if (showLevels && levels) {
      for (const l of levels.support.slice(0, 2)) add(l.price, COLORS.level, "S", LineStyle.SparseDotted, 1, false);
      for (const l of levels.resistance.slice(0, 2)) add(l.price, COLORS.level, "R", LineStyle.SparseDotted, 1, false);
    }
  }, [entry, stop, target, levels, showLevels]);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-1.5 text-[11.5px]">
        <div className="flex gap-0.5" role="tablist" aria-label="Chart timeframe">
          {timeframes.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === timeframe}
              onClick={() => onTimeframeChange(t)}
              className={`num rounded px-1.5 py-0.5 ${t === timeframe ? "bg-line-strong text-fg" : "text-muted hover:text-fg"}`}
            >
              {t}
            </button>
          ))}
        </div>
        {live !== undefined && (
          <span data-testid="chart-live" className={`flex items-center gap-1 font-semibold ${live ? (simulated ? "text-warn" : "text-pass") : "text-faint"}`} title={live ? "Updating from the live price stream" : "Not receiving live prices"}>
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-pass" : "bg-faint"}`} aria-hidden />
            {live ? (simulated ? "SIMULATED" : "LIVE") : "NOT LIVE"}
          </span>
        )}
        {loading && <span className="text-faint">loading…</span>}
        <Legend color={COLORS.entry} label="Entry" solid />
        <Legend color={COLORS.stop} label="SL" />
        <Legend color={COLORS.target} label="TP" />
        <Legend color={COLORS.price} label="Price" dotted />
        <label className="ml-auto flex items-center gap-1 text-muted">
          <input type="checkbox" checked={showEma} onChange={(e) => setShowEma(e.target.checked)} />
          <span>
            EMA <span style={{ color: COLORS.ema20 }}>20</span>/<span style={{ color: COLORS.ema50 }}>50</span>
          </span>
        </label>
        <label className="flex items-center gap-1 text-muted">
          <input type="checkbox" checked={showEma200} onChange={(e) => setShowEma200(e.target.checked)} />
          <span style={{ color: COLORS.ema200 }}>200</span>
        </label>
        {levels && (
          <label className="flex items-center gap-1 text-muted">
            <input type="checkbox" checked={showLevels} onChange={(e) => setShowLevels(e.target.checked)} />
            S/R
          </label>
        )}
      </div>
      <div className="relative w-full" style={{ height }}>
        <div ref={containerRef} className="absolute inset-0" />
        {candles.length === 0 && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted">No candle data.</div>
        )}
      </div>
    </div>
  );
}

function Legend({ color, label, solid, dotted }: { color: string; label: string; solid?: boolean; dotted?: boolean }) {
  return (
    <span className="flex items-center gap-1 text-muted">
      <span aria-hidden className="inline-block w-4" style={{ borderTop: `2px ${solid ? "solid" : dotted ? "dotted" : "dashed"} ${color}` }} />
      {label}
    </span>
  );
}
