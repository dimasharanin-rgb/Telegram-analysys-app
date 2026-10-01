import type { Candle, DataMode, Instrument, Quote, StreamStatus } from "@/shared/types/market";
import type { Timeframe } from "@/shared/types/trade";

/**
 * Anything that can supply quotes, candles and symbols. Everything outside
 * src/data depends on this interface (or on MarketDataService, which
 * implements it), never on a concrete provider or its wire format.
 */
export interface MarketDataProvider {
  readonly id: string;
  readonly name: string;
  readonly mode: DataMode;
  supportsTimeframe(timeframe: Timeframe): boolean;
  getQuote(symbol: string): Promise<Quote>;
  /** Oldest first. The last candle may still be forming. */
  getCandles(symbol: string, interval: Timeframe, outputSize: number): Promise<Candle[]>;
  searchSymbols(query: string): Promise<Instrument[]>;
}

export type QuoteListener = (quote: Quote) => void;
export type StatusListener = (status: StreamStatus) => void;

/** A push feed of prices for the UI. Never used to trigger AI analysis. */
export interface PriceStream {
  status(): StreamStatus;
  latest(symbol: string): Quote | null;
  /** Reference-counted: the feed subscribes upstream on the first subscriber and unsubscribes after the last. */
  subscribe(symbol: string): void;
  unsubscribe(symbol: string): void;
  onQuote(listener: QuoteListener): () => void;
  onStatus(listener: StatusListener): () => void;
  close(): void;
}

export type MarketDataErrorCode =
  | "INVALID_SYMBOL"
  | "UNSUPPORTED_TIMEFRAME"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "AUTH"
  | "PLAN_RESTRICTED"
  | "BAD_RESPONSE"
  | "NO_DATA"
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
