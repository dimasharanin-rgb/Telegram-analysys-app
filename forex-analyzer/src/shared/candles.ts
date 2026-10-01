import type { Candle, Quote } from "@/shared/types/market";
import { TIMEFRAME_SECONDS, type Timeframe } from "@/shared/types/trade";

/**
 * Brings the forming candle up to date with a newer live price, without
 * touching closed candles or the cached copy. If the price belongs to a bar
 * that has started since the candles were fetched, a new forming bar is added.
 */
export function applyQuoteToCandles(candles: Candle[], quote: Quote, timeframe: Timeframe): Candle[] {
  const last = candles[candles.length - 1];
  if (!last || quote.timestamp < last.timestamp) return candles;
  const tfMs = TIMEFRAME_SECONDS[timeframe] * 1000;
  const price = quote.mid;
  if (quote.timestamp < last.timestamp + tfMs) {
    return [...candles.slice(0, -1), { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) }];
  }
  const start = Math.floor(quote.timestamp / tfMs) * tfMs;
  return [...candles, { timestamp: start, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price }];
}
