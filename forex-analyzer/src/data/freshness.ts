import type { Candle, Quote } from "@/shared/types/market";
import { TIMEFRAME_SECONDS, type Timeframe } from "@/shared/types/trade";

function age(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 120) return `${s} s`;
  if (s < 7200) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

/** Why a quote cannot be trusted, or null if it can. */
export function quoteProblem(quote: Quote, nowMs: number, maxAgeSeconds: number): string | null {
  if (!Number.isFinite(quote.mid) || quote.mid <= 0) return "The quote has no valid price.";
  if (quote.bid !== null && quote.ask !== null && quote.ask < quote.bid) return "The quote has ask below bid.";
  const ageMs = nowMs - quote.timestamp;
  if (ageMs > maxAgeSeconds * 1000) {
    return `The latest ${quote.symbol} price is ${age(ageMs)} old (limit ${age(maxAgeSeconds * 1000)}). The market may be closed or the feed delayed.`;
  }
  if (ageMs < -120_000) return "The quote is timestamped in the future.";
  return null;
}

/** Why a candle series cannot be trusted (too short, malformed, out of order, stale), or null. */
export function candleProblem(candles: Candle[], timeframe: Timeframe, nowMs: number, minCount: number): string | null {
  if (candles.length === 0) return `No ${timeframe} candles were returned.`;
  if (candles.length < minCount) return `Only ${candles.length} ${timeframe} candles available (need ${minCount}).`;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)) return `${timeframe} candle data contains invalid prices.`;
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) return `${timeframe} candle data is inconsistent (high/low outside open/close).`;
    if (i > 0 && c.timestamp <= candles[i - 1]!.timestamp) return `${timeframe} candles are not in time order.`;
  }
  const tfMs = TIMEFRAME_SECONDS[timeframe] * 1000;
  const last = candles[candles.length - 1]!;
  if (last.timestamp > nowMs + 120_000) return `${timeframe} candles are timestamped in the future.`;
  if (last.timestamp + 2 * tfMs < nowMs) return `The latest ${timeframe} candle is ${age(nowMs - last.timestamp)} old. The market may be closed or the feed delayed.`;
  return null;
}

/** The quote and the candles must describe the same market. */
export function quoteMatchesCandles(quote: Quote, candles: Candle[], atr: number | null): string | null {
  const last = candles[candles.length - 1];
  if (!last) return null;
  const tolerance = Math.max(quote.mid * 0.01, (atr ?? 0) * 5);
  if (Math.abs(quote.mid - last.close) > tolerance) return `The quote (${quote.mid}) and the latest candle close (${last.close}) disagree.`;
  return null;
}
