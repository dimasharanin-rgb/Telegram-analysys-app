import type { Candle, DataMode, Instrument, MarketDataMetadata, MarketDataSnapshot, Quote, StreamStatus } from "@/shared/types/market";
import type { Timeframe } from "@/shared/types/trade";
import { getInstrument, normalizeSymbol } from "@/shared/instruments";
import { applyQuoteToCandles, CandleCache } from "./candleCache";
import { collectMarketData } from "./collect";
import { MarketDataError, type MarketDataProvider, type PriceStream } from "./types";
import type { UsageTracker } from "./usage";

export interface DataSource {
  provider: MarketDataProvider;
  stream: PriceStream;
}

export interface MarketDataServiceOptions {
  /** Null when TWELVE_DATA_API_KEY is not configured. */
  live: DataSource | null;
  liveUnavailableReason: string;
  mock: DataSource;
  mode: DataMode;
  usage: UsageTracker;
  candleTtlSeconds?: ConstructorParameters<typeof CandleCache>[0];
  /** How often to poll REST quotes per watched symbol when the WebSocket is down. */
  restPollMs?: number;
  /** A stream quote younger than this is used instead of spending a REST request. */
  streamQuoteMaxAgeMs?: number;
  now?: () => number;
}

interface Watcher {
  symbol: string;
  onQuote: (q: Quote) => void;
  onStatus: (s: StreamStatus) => void;
}

export { SNAPSHOT_CANDLES } from "./collect";

/**
 * The single entry point to market data for the rest of the application.
 *
 * - LIVE mode reads Twelve Data; if it is not configured or fails, it says so
 *   (MarketDataError). It never falls back to synthetic data while in LIVE mode.
 * - MOCK mode reads the synthetic market and is always labelled as such.
 * - Credits are conserved: candles are cached per timeframe, concurrent
 *   requests are shared, and a fresh stream price is preferred to a REST quote.
 */
export class MarketDataService implements MarketDataProvider {
  private modeValue: DataMode;
  private readonly watchers = new Set<Watcher>();
  private readonly caches = new Map<string, CandleCache>();
  private readonly quoteCache = new Map<string, { quote: Quote; at: number; pending?: Promise<Quote> }>();
  private readonly polls = new Map<string, NodeJS.Timeout>();
  private detach: (() => void)[] = [];
  private readonly now: () => number;

  constructor(private readonly options: MarketDataServiceOptions) {
    this.modeValue = options.mode;
    this.now = options.now ?? Date.now;
  }

  get mode(): DataMode {
    return this.modeValue;
  }
  get id(): string {
    return this.modeValue === "LIVE" ? (this.options.live?.provider.id ?? "unavailable") : this.options.mock.provider.id;
  }
  get name(): string {
    return this.modeValue === "LIVE" ? (this.options.live?.provider.name ?? "Twelve Data (not configured)") : this.options.mock.provider.name;
  }
  get liveConfigured(): boolean {
    return this.options.live !== null;
  }

  private source(): DataSource {
    if (this.modeValue === "MOCK") return this.options.mock;
    if (!this.options.live) throw new MarketDataError("NOT_CONFIGURED", `LIVE DATA UNAVAILABLE: ${this.options.liveUnavailableReason}`);
    return this.options.live;
  }

  private cache(): CandleCache {
    const key = this.modeValue;
    let c = this.caches.get(key);
    if (!c) {
      c = new CandleCache(this.options.candleTtlSeconds, this.options.usage, this.now);
      this.caches.set(key, c);
    }
    return c;
  }

  supportsTimeframe(timeframe: Timeframe): boolean {
    try {
      return this.source().provider.supportsTimeframe(timeframe);
    } catch {
      return false;
    }
  }

  private checkSymbol(raw: string): string {
    const spec = getInstrument(raw);
    if (!spec) throw new MarketDataError("INVALID_SYMBOL", `"${raw}" is not a recognised Forex symbol.`);
    return spec.symbol;
  }

  /** Latest price: a fresh stream price if there is one, otherwise one REST quote (shared and cached briefly). */
  async getQuote(raw: string): Promise<Quote> {
    const symbol = this.checkSymbol(raw);
    const { provider, stream } = this.source();
    const streamed = stream.latest(symbol);
    const maxAge = this.options.streamQuoteMaxAgeMs ?? 5_000;
    if (streamed && this.now() - streamed.receivedAt <= maxAge) return streamed;

    const key = `${this.modeValue}:${symbol}`;
    const cached = this.quoteCache.get(key);
    if (cached && this.now() - cached.at <= maxAge) return cached.quote;
    if (cached?.pending) return cached.pending;
    const pending = provider.getQuote(symbol);
    this.quoteCache.set(key, { quote: cached?.quote as Quote, at: cached?.at ?? 0, pending });
    try {
      const quote = await pending;
      this.quoteCache.set(key, { quote, at: this.now() });
      this.options.usage.marketUpdate(quote.timestamp);
      return quote;
    } catch (error) {
      this.quoteCache.delete(key);
      throw error;
    }
  }

  async getCandles(raw: string, interval: Timeframe, outputSize: number): Promise<Candle[]> {
    return (await this.getCandlesWithInfo(raw, interval, outputSize)).candles;
  }

  /** Cached candles with the forming bar brought up to date from the stream when a fresh price exists. */
  async getCandlesWithInfo(raw: string, interval: Timeframe, outputSize: number) {
    const symbol = this.checkSymbol(raw);
    const { provider, stream } = this.source();
    if (!provider.supportsTimeframe(interval)) throw new MarketDataError("UNSUPPORTED_TIMEFRAME", `${provider.name} does not provide ${interval} candles.`);
    const result = await this.cache().get(provider, symbol, interval, outputSize);
    const streamed = stream.latest(symbol);
    const candles = streamed ? applyQuoteToCandles(result.candles, streamed, interval) : result.candles;
    const metadata: MarketDataMetadata = { symbol, timeframe: interval, retrievedAt: result.info.fetchedAt, source: provider.id };
    return { candles, info: result.info, metadata };
  }

  async searchSymbols(query: string): Promise<Instrument[]> {
    return this.source().provider.searchSymbols(query);
  }

  /**
   * One coherent view: the latest price plus candles for the primary timeframes,
   * stamped with source and retrieval time and flagged STALE if anything is too old.
   * Goes through this service, so the cache and live stream are used.
   */
  async snapshot(raw: string, opts: { maxAgeSeconds: number; timeframes?: readonly Timeframe[]; candles?: number }): Promise<MarketDataSnapshot> {
    return collectMarketData(this, this.checkSymbol(raw), { ...opts, now: this.now });
  }

  // --- live price distribution to the UI ---

  /** Status of the live price feed for the current mode. */
  streamStatus(): StreamStatus {
    if (this.modeValue === "LIVE" && !this.options.live) {
      return { mode: "LIVE", state: "OFFLINE", transport: "none", subscribed: [], reason: `LIVE DATA UNAVAILABLE: ${this.options.liveUnavailableReason}`, lastMessageAt: null };
    }
    const status = this.source().stream.status();
    if (this.polls.size > 0 && status.state !== "LIVE") {
      return { ...status, transport: "rest-poll", reason: `${status.reason ?? "Stream unavailable"} Prices are polled every ${Math.round((this.options.restPollMs ?? 30_000) / 1000)} s instead.` };
    }
    return status;
  }

  /** Registers a UI listener for one symbol. Returns the function that removes it. */
  watch(raw: string, onQuote: (q: Quote) => void, onStatus: (s: StreamStatus) => void): () => void {
    const watcher: Watcher = { symbol: normalizeSymbol(raw), onQuote, onStatus };
    this.watchers.add(watcher);
    this.rewire();
    return () => {
      this.watchers.delete(watcher);
      this.rewire();
    };
  }

  /** Switches between LIVE and MOCK. Watchers move to the new feed; caches are kept per mode. */
  setMode(mode: DataMode): void {
    if (mode === this.modeValue) return;
    this.modeValue = mode;
    this.rewire();
  }

  private subscribedTo: { stream: PriceStream; symbols: string[] } | null = null;

  /** Brings stream subscriptions and fallback polling in line with the current watchers and mode. */
  private rewire(): void {
    for (const d of this.detach) d();
    this.detach = [];
    if (this.subscribedTo) {
      for (const s of this.subscribedTo.symbols) this.subscribedTo.stream.unsubscribe(s);
      this.subscribedTo = null;
    }
    for (const t of this.polls.values()) clearInterval(t);
    this.polls.clear();

    const symbols = [...new Set([...this.watchers].map((w) => w.symbol))];
    let src: DataSource;
    try {
      src = this.source();
    } catch {
      const status = this.streamStatus();
      for (const w of this.watchers) w.onStatus(status);
      return;
    }
    const { stream } = src;
    this.detach.push(
      stream.onQuote((q) => {
        for (const w of this.watchers) if (w.symbol === q.symbol) w.onQuote(q);
      }),
      stream.onStatus(() => this.statusChanged()),
    );
    for (const s of symbols) stream.subscribe(s);
    this.subscribedTo = { stream, symbols };
    this.statusChanged();
  }

  /** Starts sparse REST polling only while the stream is down and someone is watching. */
  private statusChanged(): void {
    const status = this.modeValue === "LIVE" && this.options.live ? this.options.live.stream.status() : null;
    const needPoll = status !== null && status.state === "OFFLINE" && this.watchers.size > 0;
    const symbols = new Set([...this.watchers].map((w) => w.symbol));
    if (needPoll) {
      for (const s of symbols) {
        if (this.polls.has(s)) continue;
        const poll = () =>
          this.getQuote(s)
            .then((q) => {
              for (const w of this.watchers) if (w.symbol === s) w.onQuote(q);
            })
            .catch((e: unknown) => {
              const st = { ...this.streamStatus(), reason: e instanceof Error ? e.message : String(e) };
              for (const w of this.watchers) if (w.symbol === s) w.onStatus(st);
            });
        void poll();
        this.polls.set(s, setInterval(poll, this.options.restPollMs ?? 30_000));
      }
    } else {
      for (const t of this.polls.values()) clearInterval(t);
      this.polls.clear();
    }
    const out = this.streamStatus();
    for (const w of this.watchers) w.onStatus(out);
  }

  close(): void {
    this.watchers.clear();
    this.rewire();
    this.options.live?.stream.close();
    this.options.mock.stream.close();
  }
}
