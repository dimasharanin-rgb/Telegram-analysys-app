import type { Quote, StreamStatus } from "@/shared/types/market";
import { normalizeSymbol } from "@/shared/instruments";
import type { MarketDataProvider, PriceStream, QuoteListener, StatusListener } from "../types";

/** Ticks synthetic quotes once a second for subscribed symbols. Costs nothing; always labelled MOCK. */
export class MockPriceStream implements PriceStream {
  private readonly wanted = new Map<string, number>();
  private readonly quotes = new Map<string, Quote>();
  private readonly quoteListeners = new Set<QuoteListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly provider: MarketDataProvider,
    private readonly intervalMs = 1000,
  ) {}

  status(): StreamStatus {
    const active = this.wanted.size > 0;
    return {
      mode: "MOCK",
      state: active ? "LIVE" : "OFFLINE",
      transport: "mock",
      subscribed: [...this.wanted.keys()],
      reason: active ? "Synthetic data" : "No symbols subscribed.",
      lastMessageAt: null,
    };
  }

  latest(symbol: string): Quote | null {
    return this.quotes.get(normalizeSymbol(symbol)) ?? null;
  }

  onQuote(l: QuoteListener) {
    this.quoteListeners.add(l);
    return () => this.quoteListeners.delete(l);
  }

  onStatus(l: StatusListener) {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  subscribe(raw: string): void {
    const s = normalizeSymbol(raw);
    this.wanted.set(s, (this.wanted.get(s) ?? 0) + 1);
    if (!this.timer) this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
    this.emit();
  }

  unsubscribe(raw: string): void {
    const s = normalizeSymbol(raw);
    const n = this.wanted.get(s) ?? 0;
    if (n > 1) this.wanted.set(s, n - 1);
    else this.wanted.delete(s);
    if (this.wanted.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.wanted.clear();
  }

  private emit(): void {
    const s = this.status();
    for (const l of this.statusListeners) l(s);
  }

  private async tick(): Promise<void> {
    for (const symbol of this.wanted.keys()) {
      try {
        const q = await this.provider.getQuote(symbol);
        this.quotes.set(q.symbol, q);
        for (const l of this.quoteListeners) l(q);
      } catch {
        // unknown mock symbol: nothing to stream
      }
    }
  }
}
