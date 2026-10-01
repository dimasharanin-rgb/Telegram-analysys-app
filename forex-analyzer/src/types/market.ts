import type { Timeframe } from "./trade";

export interface Candle {
  /** Bar open time, unix seconds (UTC). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketPrice {
  pair: string;
  /** Mid (or last) price. */
  price: number;
  bid: number | null;
  ask: number | null;
  /** ask - bid in price units, or null when the provider does not report it. */
  spread: number | null;
  /** When the provider says the quote was produced, unix ms. */
  timestamp: number;
  source: string;
}

export interface CandleSeries {
  pair: string;
  timeframe: Timeframe;
  candles: Candle[];
  source: string;
}
