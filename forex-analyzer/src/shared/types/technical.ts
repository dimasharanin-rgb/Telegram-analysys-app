import type { Timeframe } from "@/shared/types/trade";

export type StructureBias = "BULLISH" | "BEARISH" | "RANGE" | "UNCLEAR";
export type SwingLabel = "HH" | "HL" | "LH" | "LL";
export type VolatilityRegime = "LOW" | "NORMAL" | "HIGH" | "UNKNOWN";

export interface SwingPoint {
  kind: "HIGH" | "LOW";
  timestamp: number;
  price: number;
  index: number;
  /** Relative to the previous swing of the same kind. Null for the first one. */
  label: SwingLabel | null;
}

export interface MarketStructure {
  bias: StructureBias;
  swings: SwingPoint[];
  /** Labels of the most recent swings, oldest first, e.g. ["HH", "HL", "HH", "HL"]. */
  sequence: SwingLabel[];
  /** The rule that produced the bias, in plain words. */
  reason: string;
}

/** A technical reference zone from recent swings, not an exact price. */
export interface PriceLevel {
  price: number;
  touches: number;
  kind: "SUPPORT" | "RESISTANCE";
  /** SWING: a single swing point. CLUSTER: several nearby swings averaged. */
  source: "SWING" | "CLUSTER";
  /** Number of swings in the zone (higher = tested more often). */
  strength: number;
  /** Distance from the current price, in ATRs of this timeframe. */
  distanceAtr: number | null;
}

export interface IndicatorSet {
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  atr14: number | null;
  /** ATR as a percent of the close. */
  atrPercent: number | null;
  volatility: VolatilityRegime;
  /** current ATR / median ATR over the lookback. */
  volatilityRatio: number | null;
  lastClose: number;
}

export type TrendDirection = "BULLISH" | "BEARISH" | "MIXED" | "UNKNOWN";
export type MomentumClass = "OVERSOLD" | "WEAK_BEARISH" | "NEUTRAL" | "BULLISH" | "OVERBOUGHT" | "UNKNOWN";

/** EMA alignment and where price sits relative to the EMAs. Market state, not a signal. */
export interface TrendState {
  /** BULLISH: EMA20 > EMA50 > EMA200. BEARISH: EMA20 < EMA50 < EMA200. */
  direction: TrendDirection;
  ema20Above50: boolean | null;
  ema50Above200: boolean | null;
  priceAbove20: boolean | null;
  priceAbove50: boolean | null;
  priceAbove200: boolean | null;
  /** (close - EMA) / ATR, signed. */
  distanceFromEma20Atr: number | null;
  distanceFromEma50Atr: number | null;
}

/** RSI context. OVERSOLD does not mean "buy"; it is a description. */
export interface MomentumState {
  rsi14: number | null;
  state: MomentumClass;
  /** RSI now minus RSI `momentumLookbackBars` ago. */
  rsiChange: number | null;
}

export interface VolatilityState {
  atr14: number | null;
  /** ATR as a percent of price. */
  atrPercent: number | null;
  /** Current ATR / its recent median. */
  ratio: number | null;
  state: VolatilityRegime;
  /** High-low range of the last `compressionBars` candles, in ATRs (small = compression). */
  recentRangeAtr: number | null;
}

export interface TimeframeAnalysis {
  timeframe: Timeframe;
  candleCount: number;
  lastCandleTime: number;
  indicators: IndicatorSet;
  structure: MarketStructure;
  recentSwingHighs: number[];
  recentSwingLows: number[];
  support: PriceLevel[];
  resistance: PriceLevel[];
  emaTrend: "UP" | "DOWN" | "MIXED" | "UNKNOWN";
  trend: TrendState;
  momentum: MomentumState;
  volatility: VolatilityState;
}
