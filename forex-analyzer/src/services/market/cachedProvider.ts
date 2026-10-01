import type { Candle, MarketPrice } from "@/types/market";
import type { Timeframe } from "@/types/trade";
import type { MarketDataProvider } from "./types";

interface Entry<T> {
  expires: number;
  value: Promise<T>;
}

/**
 * Short-lived cache in front of a provider, so a risk preview followed by an
 * analysis does not spend the provider's rate limit twice. Failures are not cached.
 */
export class CachedMarketDataProvider implements MarketDataProvider {
  private readonly cache = new Map<string, Entry<unknown>>();

  constructor(
    private readonly inner: MarketDataProvider,
    private readonly ttl = { priceMs: 10_000, candlesMs: 30_000 },
  ) {}

  get id() {
    return this.inner.id;
  }
  get name() {
    return this.inner.name;
  }
  get isMock() {
    return this.inner.isMock;
  }

  supportsTimeframe(timeframe: Timeframe): boolean {
    return this.inner.supportsTimeframe(timeframe);
  }

  private cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key) as Entry<T> | undefined;
    if (hit && hit.expires > now) return hit.value;
    const value = load();
    this.cache.set(key, { expires: now + ttlMs, value });
    value.catch(() => this.cache.delete(key));
    return value;
  }

  getCurrentPrice(pair: string): Promise<MarketPrice> {
    return this.cached(`p:${pair}`, this.ttl.priceMs, () => this.inner.getCurrentPrice(pair));
  }

  getCandles(pair: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    return this.cached(`c:${pair}:${timeframe}:${limit}`, this.ttl.candlesMs, () => this.inner.getCandles(pair, timeframe, limit));
  }
}
