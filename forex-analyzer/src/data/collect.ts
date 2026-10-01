import type { Candle, MarketDataSnapshot, Quote } from "@/shared/types/market";
import { PRIMARY_TIMEFRAMES, type Timeframe } from "@/shared/types/trade";
import { candleProblem, quoteProblem } from "./freshness";
import type { MarketDataProvider } from "./types";

/** Candles fetched per timeframe: enough for EMA 200 plus margin. */
export const SNAPSHOT_CANDLES = 260;

export interface CollectOptions {
  timeframes?: readonly Timeframe[];
  candles?: number;
  /** Data older than this is flagged stale. */
  maxAgeSeconds: number;
  now: () => number;
}

/**
 * Gathers one coherent set of normalised market data (latest quote plus
 * candles per timeframe) from any MarketDataProvider, stamped with its source
 * and retrieval time and a staleness verdict. No analysis happens here.
 * Provider errors (MarketDataError) propagate to the caller.
 */
export async function collectMarketData(provider: MarketDataProvider, symbol: string, opts: CollectOptions): Promise<MarketDataSnapshot> {
  const timeframes = (opts.timeframes ?? PRIMARY_TIMEFRAMES).filter((tf) => provider.supportsTimeframe(tf));
  const count = opts.candles ?? SNAPSHOT_CANDLES;
  const [quote, ...series] = (await Promise.all([
    provider.getQuote(symbol),
    ...timeframes.map((tf) => provider.getCandles(symbol, tf, count)),
  ])) as [Quote, ...Candle[][]];

  const now = opts.now();
  const candles: MarketDataSnapshot["candles"] = {};
  const staleReasons: string[] = [];
  const quoteIssue = quoteProblem(quote, now, opts.maxAgeSeconds);
  if (quoteIssue) staleReasons.push(quoteIssue);
  timeframes.forEach((tf, i) => {
    candles[tf] = series[i]!;
    const issue = candleProblem(series[i]!, tf, now, 1);
    if (issue) staleReasons.push(issue);
  });
  const newestCandle = Math.max(0, ...Object.values(candles).map((c) => c?.at(-1)?.timestamp ?? 0));

  return {
    symbol: quote.symbol,
    mode: provider.mode,
    source: provider.id,
    sourceName: provider.name,
    quote,
    candles,
    dataTimestamp: Math.max(quote.timestamp, newestCandle),
    retrievedAt: now,
    stale: staleReasons.length > 0,
    staleReasons,
  };
}
