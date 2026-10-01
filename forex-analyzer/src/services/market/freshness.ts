import type { Candle, MarketPrice } from "@/types/market";
import { TIMEFRAME_SECONDS, type Timeframe } from "@/types/trade";

/** Returns why a quote cannot be trusted, or null if it can. */
export function quoteProblem(price: MarketPrice, now: Date, maxAgeSeconds: number): string | null {
  if (!Number.isFinite(price.price) || price.price <= 0) return "The quote has no valid price.";
  if (price.bid !== null && price.ask !== null && price.ask < price.bid) return "The quote has ask below bid.";
  const ageSeconds = (now.getTime() - price.timestamp) / 1000;
  if (ageSeconds > maxAgeSeconds) {
    return `The latest quote is ${Math.round(ageSeconds / 60)} min old (limit ${Math.round(maxAgeSeconds / 60)} min). The market may be closed.`;
  }
  if (ageSeconds < -120) return "The quote is timestamped in the future.";
  return null;
}

/** Returns why a candle series cannot be trusted (too short, malformed, out of order, stale), or null. */
export function candleProblem(candles: Candle[], timeframe: Timeframe, now: Date, minCount: number): string | null {
  if (candles.length < minCount) return `Only ${candles.length} ${timeframe} candles available (need ${minCount}).`;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const values = [c.open, c.high, c.low, c.close];
    if (!values.every((v) => Number.isFinite(v) && v > 0)) return `${timeframe} candle data contains invalid prices.`;
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
      return `${timeframe} candle data is inconsistent (high/low outside open/close).`;
    }
    if (i > 0 && c.time <= candles[i - 1]!.time) return `${timeframe} candles are not in time order.`;
  }
  const tfSeconds = TIMEFRAME_SECONDS[timeframe];
  const nowSeconds = now.getTime() / 1000;
  const last = candles[candles.length - 1]!;
  if (last.time > nowSeconds + 120) return `${timeframe} candles are timestamped in the future.`;
  if (last.time + 2 * tfSeconds < nowSeconds) {
    const hours = (nowSeconds - last.time) / 3600;
    return `The latest ${timeframe} candle is ${hours >= 1 ? `${hours.toFixed(1)} h` : `${Math.round(hours * 60)} min`} old. The market may be closed or the feed delayed.`;
  }
  return null;
}

/** The quote and the candles must describe the same market. */
export function quoteMatchesCandles(price: MarketPrice, candles: Candle[], atr: number | null): string | null {
  const last = candles[candles.length - 1];
  if (!last) return null;
  const tolerance = Math.max(price.price * 0.01, (atr ?? 0) * 5);
  if (Math.abs(price.price - last.close) > tolerance) {
    return `The quote (${price.price}) and the latest candle close (${last.close}) disagree.`;
  }
  return null;
}
