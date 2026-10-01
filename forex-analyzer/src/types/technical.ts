import type { Timeframe } from "./trade";

export type StructureBias = "BULLISH" | "BEARISH" | "RANGE" | "UNCLEAR";
export type SwingLabel = "HH" | "HL" | "LH" | "LL";
export type VolatilityRegime = "LOW" | "NORMAL" | "HIGH" | "UNKNOWN";

export interface SwingPoint {
  kind: "HIGH" | "LOW";
  time: number;
  price: number;
  index: number;
  /** Relative to the previous swing of the same kind. Null for the first one. */
  label: SwingLabel | null;
}

export interface MarketStructure {
  bias: StructureBias;
  swings: SwingPoint[];
  /** The rule that produced the bias, in plain words. */
  reason: string;
}

export interface PriceLevel {
  price: number;
  touches: number;
  kind: "SUPPORT" | "RESISTANCE";
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
}
