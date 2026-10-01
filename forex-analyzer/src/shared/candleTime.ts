import type { Candle } from "@/shared/types/market";
import { TIMEFRAME_SECONDS, type Timeframe } from "@/shared/types/trade";

/** Unix ms at which a candle closes. */
export function candleCloseTime(candle: Candle, timeframe: Timeframe): number {
  return candle.timestamp + TIMEFRAME_SECONDS[timeframe] * 1000;
}

/**
 * The candles that were knowable at time `asOf` (unix ms): every candle that
 * had closed by then. With `includeForming`, the bar open at `asOf` is kept as
 * well (live use, where its current values are real); a historical caller must
 * leave it out, because that bar's stored OHLC includes prices from after `asOf`.
 *
 * Input must be oldest-first. Never returns anything from after `asOf`.
 */
export function candlesKnownAt(candles: Candle[], timeframe: Timeframe, asOf: number, opts: { includeForming?: boolean } = {}): Candle[] {
  let end = candles.length;
  while (end > 0) {
    const c = candles[end - 1]!;
    const known = opts.includeForming ? c.timestamp <= asOf : candleCloseTime(c, timeframe) <= asOf;
    if (known) break;
    end--;
  }
  return end === candles.length ? candles : candles.slice(0, end);
}
