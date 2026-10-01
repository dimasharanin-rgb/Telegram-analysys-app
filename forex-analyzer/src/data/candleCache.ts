import type { Candle, CandleCacheInfo } from "@/shared/types/market";
import type { Timeframe } from "@/shared/types/trade";
import type { MarketDataProvider } from "./types";
import type { UsageTracker } from "./usage";

/**
 * How long fetched candles are reused before Twelve Data is asked again.
 * Roughly a third to a half of a bar for short timeframes: closed bars never
 * change, and the forming bar is kept current from the live stream instead.
 */
export const DEFAULT_CANDLE_TTL_SECONDS: Record<Timeframe, number> = {
  M1: 15,
  M5: 30,
  M15: 60,
  M30: 90,
  H1: 120,
  H2: 240,
  H4: 300,
  D1: 900,
};

interface Entry {
  candles: Candle[];
  /** How many candles were asked for: a provider may return fewer when history is short. */
  requested: number;
  fetchedAt: number;
  pending: Promise<Candle[]> | null;
}

export class CandleCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlSeconds: Record<Timeframe, number> = DEFAULT_CANDLE_TTL_SECONDS,
    private readonly usage?: UsageTracker,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Returns the newest `count` candles. Serves from cache while fresh and large
   * enough; otherwise one request (shared by concurrent callers) refreshes it.
   */
  async get(provider: MarketDataProvider, symbol: string, timeframe: Timeframe, count: number): Promise<{ candles: Candle[]; info: CandleCacheInfo }> {
    const key = `${provider.id}:${symbol}:${timeframe}`;
    let entry = this.entries.get(key);
    const fresh = entry && entry.requested >= count && this.now() - entry.fetchedAt < this.ttlSeconds[timeframe] * 1000;
    if (entry && fresh) {
      this.usage?.cacheHit();
      return { candles: entry.candles.slice(-count), info: { fetchedAt: entry.fetchedAt, fromCache: true } };
    }
    if (entry?.pending) {
      await entry.pending;
      return this.get(provider, symbol, timeframe, count);
    }
    this.usage?.cacheMiss();
    const size = Math.max(count, entry?.requested ?? 0);
    const pending = provider.getCandles(symbol, timeframe, size);
    entry = { candles: entry?.candles ?? [], requested: entry?.requested ?? 0, fetchedAt: entry?.fetchedAt ?? 0, pending };
    this.entries.set(key, entry);
    try {
      const candles = await pending;
      const fetchedAt = this.now();
      this.entries.set(key, { candles, requested: size, fetchedAt, pending: null });
      return { candles: candles.slice(-count), info: { fetchedAt, fromCache: false } };
    } catch (error) {
      entry.pending = null;
      if (entry.candles.length === 0) this.entries.delete(key);
      throw error;
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export { applyQuoteToCandles } from "@/shared/candles";
