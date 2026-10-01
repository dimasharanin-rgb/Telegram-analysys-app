import WebSocket from "ws";
import type { Quote, StreamState, StreamStatus } from "@/shared/types/market";
import { normalizeSymbol } from "@/shared/instruments";
import type { PriceStream, QuoteListener, StatusListener } from "../types";
import type { UsageTracker } from "../usage";
import { parseStreamPrice } from "./normalize";

export interface TwelveDataStreamOptions {
  apiKey: string;
  /** Default wss://ws.twelvedata.com */
  url?: string;
  heartbeatMs?: number;
  /** Reconnect if nothing (not even a heartbeat reply) arrives for this long. */
  silenceTimeoutMs?: number;
  backoffMs?: { initial: number; max: number };
  usage?: UsageTracker;
  now?: () => number;
  /** Injected in tests. */
  createSocket?: (url: string) => WebSocket;
}

/**
 * Twelve Data real-time price WebSocket (/v1/quotes/price).
 *
 * - Connects only while at least one symbol is wanted and disconnects when
 *   none is, so subscription credits are not held needlessly.
 * - Subscriptions are reference counted; reconnects resubscribe everything.
 * - Sends {"action":"heartbeat"} every 10 s and reconnects if the line goes silent.
 * - Exponential backoff between reconnect attempts; stops retrying when the key is rejected.
 *
 * Quotes only update the UI. Nothing here can trigger an AI call.
 */
export class TwelveDataPriceStream implements PriceStream {
  private socket: WebSocket | null = null;
  private state: StreamState = "OFFLINE";
  private reason: string | null = "No symbols subscribed.";
  private readonly wanted = new Map<string, number>();
  private readonly upstream = new Set<string>();
  private readonly quotes = new Map<string, Quote>();
  private readonly quoteListeners = new Set<QuoteListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private heartbeat: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempts = 0;
  private lastMessageAt: number | null = null;
  private fatal = false;
  private closed = false;
  private readonly now: () => number;

  constructor(private readonly options: TwelveDataStreamOptions) {
    this.now = options.now ?? Date.now;
  }

  status(): StreamStatus {
    return {
      mode: "LIVE",
      state: this.state,
      transport: "websocket",
      subscribed: [...this.upstream],
      reason: this.reason,
      lastMessageAt: this.lastMessageAt,
    };
  }

  latest(symbol: string): Quote | null {
    return this.quotes.get(normalizeSymbol(symbol)) ?? null;
  }

  onQuote(listener: QuoteListener): () => void {
    this.quoteListeners.add(listener);
    return () => this.quoteListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  subscribe(raw: string): void {
    const symbol = normalizeSymbol(raw);
    const count = this.wanted.get(symbol) ?? 0;
    this.wanted.set(symbol, count + 1);
    if (count > 0) return;
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ action: "subscribe", params: { symbols: symbol } });
    else this.ensureConnected();
  }

  unsubscribe(raw: string): void {
    const symbol = normalizeSymbol(raw);
    const count = this.wanted.get(symbol) ?? 0;
    if (count > 1) {
      this.wanted.set(symbol, count - 1);
      return;
    }
    this.wanted.delete(symbol);
    if (this.upstream.delete(symbol) && this.socket?.readyState === WebSocket.OPEN) {
      this.send({ action: "unsubscribe", params: { symbols: symbol } });
    }
    if (this.wanted.size === 0) this.disconnect("No symbols subscribed.");
    else this.emitStatus();
  }

  close(): void {
    this.closed = true;
    this.wanted.clear();
    this.disconnect("Stream closed.");
    this.quoteListeners.clear();
    this.statusListeners.clear();
  }

  // --- connection management ---

  private setState(state: StreamState, reason: string | null): void {
    this.state = state;
    this.reason = reason;
    this.emitStatus();
  }

  private emitStatus(): void {
    const s = this.status();
    for (const l of this.statusListeners) l(s);
  }

  private ensureConnected(): void {
    if (this.closed || this.fatal || this.socket || this.reconnectTimer || this.wanted.size === 0) return;
    this.connect();
  }

  private connect(): void {
    const base = this.options.url ?? "wss://ws.twelvedata.com";
    const url = `${base}/v1/quotes/price?apikey=${encodeURIComponent(this.options.apiKey)}`;
    const reconnecting = this.attempts > 0;
    this.setState(reconnecting ? "RECONNECTING" : "CONNECTING", reconnecting ? "Reconnecting to Twelve Data…" : null);
    const socket = this.options.createSocket ? this.options.createSocket(url) : new WebSocket(url);
    this.socket = socket;

    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.options.usage?.wsConnect(reconnecting);
      this.lastMessageAt = this.now();
      this.upstream.clear();
      const symbols = [...this.wanted.keys()];
      if (symbols.length) this.send({ action: "subscribe", params: { symbols: symbols.join(",") } });
      this.heartbeat = setInterval(() => this.send({ action: "heartbeat" }), this.options.heartbeatMs ?? 10_000);
      this.armWatchdog();
    });
    socket.on("message", (data) => this.handleMessage(socket, data.toString()));
    socket.on("error", () => {
      // "close" follows and handles reconnection.
    });
    socket.on("unexpected-response", (_req, res) => {
      if (res.statusCode === 401 || res.statusCode === 403) this.fail(`Twelve Data refused the WebSocket connection (HTTP ${res.statusCode}). Check the API key and plan.`);
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.teardown();
      if (this.closed || this.fatal) return;
      if (this.wanted.size === 0) {
        this.setState("OFFLINE", "No symbols subscribed.");
        return;
      }
      this.scheduleReconnect();
    });
  }

  private handleMessage(socket: WebSocket, text: string): void {
    if (this.socket !== socket) return;
    this.lastMessageAt = this.now();
    this.options.usage?.wsMessage();
    this.armWatchdog();
    let message: { event?: string; status?: string; success?: { symbol: string }[]; fails?: { symbol: string }[] | null; message?: string };
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }

    if (message.event === "price") {
      const quote = parseStreamPrice(message, this.now());
      if (!quote || !this.wanted.has(quote.symbol)) return;
      if (this.state !== "LIVE") this.setState("LIVE", null);
      this.quotes.set(quote.symbol, quote);
      this.options.usage?.marketUpdate(quote.timestamp);
      for (const l of this.quoteListeners) l(quote);
      return;
    }

    if (message.event === "subscribe-status") {
      for (const s of message.success ?? []) this.upstream.add(normalizeSymbol(s.symbol));
      const fails = (message.fails ?? []).map((f) => normalizeSymbol(f.symbol));
      this.attempts = 0;
      if (message.status === "error" && /api ?key/i.test(message.message ?? "")) {
        this.fail(`Twelve Data rejected the API key: ${message.message}`);
        return;
      }
      if (this.upstream.size > 0) this.setState("LIVE", fails.length ? `Not available on the stream: ${fails.join(", ")}` : null);
      else this.setState("OFFLINE", fails.length ? `Twelve Data did not accept: ${fails.join(", ")} (plan or symbol).` : message.message ?? "Subscription failed.");
      return;
    }

    if (message.event === "heartbeat") return;
  }

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      // No traffic at all, not even heartbeat replies: the connection is dead even if the socket looks open.
      this.socket?.terminate();
    }, this.options.silenceTimeoutMs ?? 30_000);
  }

  private scheduleReconnect(): void {
    const { initial, max } = this.options.backoffMs ?? { initial: 1_000, max: 30_000 };
    const delay = Math.min(max, initial * 2 ** this.attempts);
    this.attempts++;
    this.setState("RECONNECTING", `Connection lost. Retrying in ${Math.round(delay / 1000)} s.`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wanted.size > 0 && !this.closed) this.connect();
    }, delay);
  }

  private fail(reason: string): void {
    this.fatal = true;
    this.socket?.terminate();
    this.teardown();
    this.setState("OFFLINE", reason);
  }

  private teardown(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.heartbeat = null;
    this.watchdog = null;
    this.socket?.removeAllListeners("message");
    this.socket = null;
    this.upstream.clear();
  }

  private disconnect(reason: string): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempts = 0;
    const socket = this.socket;
    this.teardown();
    socket?.close();
    this.setState("OFFLINE", reason);
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
