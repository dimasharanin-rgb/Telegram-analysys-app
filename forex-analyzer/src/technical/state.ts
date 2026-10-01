import type { Candle } from "@/shared/types/market";
import type { IndicatorSet, MomentumClass, MomentumState, TrendState, VolatilityState } from "@/shared/types/technical";
import { DEFAULT_TECHNICAL_CONFIG, type TechnicalConfig } from "./config";
import { rsi } from "./indicators";

/** RSI 14 → descriptive band. Context only: OVERSOLD is not "buy", OVERBOUGHT is not "sell". */
export function classifyMomentum(value: number | null, bands: TechnicalConfig["rsi"] = DEFAULT_TECHNICAL_CONFIG.rsi): MomentumClass {
  if (value === null) return "UNKNOWN";
  if (value < bands.oversold) return "OVERSOLD";
  if (value < bands.weakBearish) return "WEAK_BEARISH";
  if (value < bands.neutralHigh) return "NEUTRAL";
  if (value <= bands.overbought) return "BULLISH";
  return "OVERBOUGHT";
}

export function momentumState(candles: Candle[], ind: IndicatorSet, config: TechnicalConfig = DEFAULT_TECHNICAL_CONFIG): MomentumState {
  const series = rsi(candles.map((c) => c.close), 14);
  const past = series[series.length - 1 - config.momentumLookbackBars] ?? null;
  return {
    rsi14: ind.rsi14,
    state: classifyMomentum(ind.rsi14, config.rsi),
    rsiChange: ind.rsi14 !== null && past !== null ? ind.rsi14 - past : null,
  };
}

/** EMA stacking and price position. BULLISH needs EMA20 > EMA50 > EMA200 (EMA200 ignored only when there is not enough history for it). */
export function trendState(ind: IndicatorSet): TrendState {
  const { ema20, ema50, ema200, lastClose, atr14 } = ind;
  const above = (a: number | null, b: number | null) => (a === null || b === null ? null : a > b);
  const dist = (ema: number | null) => (ema === null || atr14 === null || atr14 === 0 ? null : (lastClose - ema) / atr14);
  const e20 = above(ema20, ema50);
  const e50 = above(ema50, ema200);
  let direction: TrendState["direction"] = "UNKNOWN";
  if (e20 !== null) {
    if (e20 && (e50 === null || e50)) direction = "BULLISH";
    else if (!e20 && (e50 === null || !e50)) direction = "BEARISH";
    else direction = "MIXED";
  }
  return {
    direction,
    ema20Above50: e20,
    ema50Above200: e50,
    priceAbove20: above(lastClose, ema20),
    priceAbove50: above(lastClose, ema50),
    priceAbove200: above(lastClose, ema200),
    distanceFromEma20Atr: dist(ema20),
    distanceFromEma50Atr: dist(ema50),
  };
}

export function volatilityState(candles: Candle[], ind: IndicatorSet, config: TechnicalConfig = DEFAULT_TECHNICAL_CONFIG): VolatilityState {
  const recent = candles.slice(-config.compressionBars);
  const range = recent.length ? Math.max(...recent.map((c) => c.high)) - Math.min(...recent.map((c) => c.low)) : null;
  return {
    atr14: ind.atr14,
    atrPercent: ind.atrPercent,
    ratio: ind.volatilityRatio,
    state: ind.volatility,
    recentRangeAtr: range !== null && ind.atr14 ? range / ind.atr14 : null,
  };
}
