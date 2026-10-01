import type { Candle, MarketPrice } from "@/types/market";
import type { Timeframe } from "@/types/trade";

/**
 * Anything that can supply prices and candles. The analyzer depends only on
 * this interface, so a provider can be swapped without touching the analysis.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly name: string;
  readonly isMock: boolean;
  supportsTimeframe(timeframe: Timeframe): boolean;
  getCurrentPrice(pair: string): Promise<MarketPrice>;
  /** Oldest first. The last candle may still be forming. */
  getCandles(pair: string, timeframe: Timeframe, limit: number): Promise<Candle[]>;
}

export type MarketDataErrorCode =
  | "UNSUPPORTED_PAIR"
  | "UNSUPPORTED_TIMEFRAME"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "BAD_RESPONSE"
  | "UNAVAILABLE"
  | "NOT_CONFIGURED";

export class MarketDataError extends Error {
  constructor(
    readonly code: MarketDataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}
