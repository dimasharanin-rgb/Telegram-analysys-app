import type { Timeframe } from "./trade";

/** Normalised market data. Nothing outside src/data knows a provider's raw format. */

export interface Candle {
  /** Bar open time, unix milliseconds (UTC). */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Not reported for most Forex feeds. */
  volume?: number;
}

/** Where a piece of market data came from and when this server obtained it. */
export interface MarketDataMetadata {
  symbol: string;
  timeframe?: Timeframe;
  /** When this server retrieved the data (unix ms). */
  retrievedAt: number;
  /** Provider id, e.g. "twelvedata" or "mock". */
  source: string;
}

export type QuoteSource = "twelvedata-ws" | "twelvedata-rest" | "mock";

export interface Quote {
  /** "EUR/USD" */
  symbol: string;
  /** Null when the source does not report it (Twelve Data REST quotes have no bid/ask). */
  bid: number | null;
  ask: number | null;
  /** Mid price, or the last price when bid/ask are unknown. */
  mid: number;
  /** ask - bid, or null when unknown. */
  spread: number | null;
  /** When the provider says the price was produced, unix ms. */
  timestamp: number;
  /** When this server received it, unix ms. */
  receivedAt: number;
  source: QuoteSource;
}

/** A tradable symbol as returned by symbol search. */
export interface Instrument {
  symbol: string;
  name: string;
  base: string;
  quote: string;
  type: "FX" | "METAL";
}

export type DataMode = "LIVE" | "MOCK";

/** Connection state of the live price stream, as shown in the UI. */
export type StreamState = "LIVE" | "CONNECTING" | "RECONNECTING" | "OFFLINE";

export interface StreamStatus {
  mode: DataMode;
  state: StreamState;
  /** "websocket" for a streaming feed, "rest-poll" when the stream is unavailable and quotes are polled sparingly. */
  transport: "websocket" | "rest-poll" | "mock" | "none";
  subscribed: string[];
  /** Why the stream is not live, in plain words. */
  reason: string | null;
  lastMessageAt: number | null;
}

export interface CandleCacheInfo {
  fetchedAt: number;
  fromCache: boolean;
}

/** Candles plus where and when they came from. */
export interface CandleSeries {
  candles: Candle[];
  metadata: MarketDataMetadata;
}

/** One coherent view of the market at the moment it was assembled. */
export interface MarketDataSnapshot {
  symbol: string;
  mode: DataMode;
  /** Provider id ("twelvedata", "mock"). */
  source: string;
  sourceName: string;
  quote: Quote;
  candles: Partial<Record<Timeframe, Candle[]>>;
  /** When the newest price in the snapshot was produced by the market (unix ms). */
  dataTimestamp: number;
  /** When this server assembled the snapshot (unix ms). */
  retrievedAt: number;
  stale: boolean;
  staleReasons: string[];
  /** Present when the data went through the candle cache. */
  cache?: Partial<Record<Timeframe, CandleCacheInfo>>;
}
