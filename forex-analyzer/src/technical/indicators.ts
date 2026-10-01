import type { Candle } from "@/shared/types/market";
import type { IndicatorSet, VolatilityRegime } from "@/shared/types/technical";
import { median } from "@/shared/math";

/** Exponential moving average seeded with the simple average of the first `period` values. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const value = () => (avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss));
  out[period] = value();
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
}

/** Wilder's Average True Range. */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const tr = trueRange(candles);
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

const VOLATILITY_LOOKBACK = 100;

/** Current ATR relative to its median over the lookback: below 0.75 is LOW, above 1.35 is HIGH. */
export function volatilityRegime(atrSeries: (number | null)[]): { regime: VolatilityRegime; ratio: number | null } {
  const recent = atrSeries.slice(-VOLATILITY_LOOKBACK).filter((v): v is number => v !== null);
  const current = atrSeries.at(-1) ?? null;
  const med = median(recent);
  if (current === null || med === null || recent.length < 30 || med === 0) return { regime: "UNKNOWN", ratio: null };
  const ratio = current / med;
  return { regime: ratio < 0.75 ? "LOW" : ratio > 1.35 ? "HIGH" : "NORMAL", ratio };
}

function last(series: (number | null)[]): number | null {
  return series.length ? (series[series.length - 1] ?? null) : null;
}

/** Objective indicator values at the latest candle. Null where history is too short to compute one. */
export function calculateIndicators(candles: Candle[]): IndicatorSet {
  const closes = candles.map((c) => c.close);
  const atrSeries = atr(candles, 14);
  const atr14 = last(atrSeries);
  const lastClose = closes.at(-1) ?? Number.NaN;
  const vol = volatilityRegime(atrSeries);
  return {
    ema20: last(ema(closes, 20)),
    ema50: last(ema(closes, 50)),
    ema200: last(ema(closes, 200)),
    rsi14: last(rsi(closes, 14)),
    atr14,
    atrPercent: atr14 !== null && lastClose > 0 ? (atr14 / lastClose) * 100 : null,
    volatility: vol.regime,
    volatilityRatio: vol.ratio,
    lastClose,
  };
}
