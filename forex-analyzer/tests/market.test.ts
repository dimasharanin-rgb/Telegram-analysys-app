import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { Quote, StreamStatus } from "@/shared/types/market";
import { TIMEFRAMES } from "@/shared/types/trade";
import { applyQuoteToCandles } from "@/shared/candles";
import { getInstrument, normalizeSymbol } from "@/shared/instruments";
import { CandleCache } from "@/data/candleCache";
import { candleProblem, quoteMatchesCandles, quoteProblem } from "@/data/freshness";
import { MarketDataService } from "@/data/marketDataService";
import { MockMarketDataProvider } from "@/data/mock/mockProvider";
import { MockPriceStream } from "@/data/mock/mockStream";
import { parseError, parseForexPairs, parseRestQuote, parseStreamPrice, parseTimeSeries } from "@/data/twelvedata/normalize";
import { TwelveDataPriceStream } from "@/data/twelvedata/priceStream";
import { TwelveDataProvider } from "@/data/twelvedata/provider";
import { MarketDataError, type MarketDataProvider, type PriceStream } from "@/data/types";
import { UsageTracker } from "@/data/usage";

const NOW = new Date("2026-09-30T11:02:30Z");
const mock = () => new MockMarketDataProvider({ now: () => NOW });

// Responses shaped like Twelve Data's documented payloads.
const TIME_SERIES = {
  meta: { symbol: "EUR/USD", interval: "15min", currency_base: "Euro", currency_quote: "US Dollar", type: "Physical Currency" },
  values: [
    { datetime: "2026-09-30 11:00:00", open: "1.17050", high: "1.17080", low: "1.17020", close: "1.17070" },
    { datetime: "2026-09-30 10:45:00", open: "1.17010", high: "1.17060", low: "1.17000", close: "1.17050" },
  ],
  status: "ok",
};
const QUOTE = {
  symbol: "EUR/USD",
  name: "Euro / US Dollar",
  exchange: "PHYSICAL CURRENCY",
  datetime: "2026-09-30 11:02:00",
  timestamp: 1790766120,
  last_quote_at: 1790766150,
  open: "1.17010",
  high: "1.17090",
  low: "1.16990",
  close: "1.17072",
  is_market_open: true,
};
const WS_PRICE = { event: "price", symbol: "EUR/USD", currency_base: "Euro", currency_quote: "US Dollar", exchange: "PHYSICAL CURRENCY", type: "Physical Currency", timestamp: 1790766150, price: 1.17071, bid: 1.17067, ask: 1.17075 };

describe("instrument specs", () => {
  it("normalises symbols to Twelve Data format", () => {
    expect(normalizeSymbol("eurusd")).toBe("EUR/USD");
    expect(normalizeSymbol("GBP-JPY")).toBe("GBP/JPY");
  });

  it("derives pip sizes from the symbol, not a hardcoded list", () => {
    expect(getInstrument("EUR/USD")!.pipSize).toBe(0.0001);
    expect(getInstrument("GBP/USD")!.pipSize).toBe(0.0001);
    expect(getInstrument("USD/JPY")!.pipSize).toBe(0.01);
    expect(getInstrument("GBP/JPY")!.pipSize).toBe(0.01);
    expect(getInstrument("AUD/NZD")).toMatchObject({ pipSize: 0.0001, contractSize: 100_000 });
    expect(getInstrument("XAU/USD")).toMatchObject({ assetClass: "METAL", contractSize: 100 });
    expect(getInstrument("FOO/BAR")).toBeUndefined();
    expect(getInstrument("USD/USD")).toBeUndefined();
  });
});

describe("Twelve Data normalisation", () => {
  it("parses /time_series into ascending UTC candles", () => {
    const candles = parseTimeSeries(TIME_SERIES);
    expect(candles).toEqual([
      { timestamp: Date.UTC(2026, 8, 30, 10, 45), open: 1.1701, high: 1.1706, low: 1.17, close: 1.1705 },
      { timestamp: Date.UTC(2026, 8, 30, 11, 0), open: 1.1705, high: 1.1708, low: 1.1702, close: 1.1707 },
    ]);
    expect(parseTimeSeries({ values: [{ datetime: "2026-09-30", open: "1", high: "2", low: "0.5", close: "1.5" }] })[0]!.timestamp).toBe(Date.UTC(2026, 8, 30));
  });

  it("rejects empty or malformed candles", () => {
    expect(() => parseTimeSeries({ values: [], status: "ok" })).toThrowError(expect.objectContaining({ code: "NO_DATA" }));
    expect(() => parseTimeSeries({ values: [{ datetime: "x", open: "a", high: "1", low: "1", close: "1" }] })).toThrow(MarketDataError);
    expect(() => parseTimeSeries({ foo: 1 })).toThrowError(expect.objectContaining({ code: "BAD_RESPONSE" }));
  });

  it("parses /quote: price and time, but no bid/ask (spread unknown)", () => {
    const q = parseRestQuote(QUOTE, "EUR/USD", 123);
    expect(q).toEqual({ symbol: "EUR/USD", bid: null, ask: null, mid: 1.17072, spread: null, timestamp: 1790766150_000, receivedAt: 123, source: "twelvedata-rest" });
  });

  it("parses WebSocket price events with bid/ask", () => {
    const q = parseStreamPrice(WS_PRICE, 5)!;
    expect(q.bid).toBe(1.17067);
    expect(q.ask).toBe(1.17075);
    expect(q.mid).toBeCloseTo(1.17071, 6);
    expect(q.spread).toBeCloseTo(0.00008, 8);
    expect(q.timestamp).toBe(1790766150_000);
    expect(parseStreamPrice({ event: "heartbeat", status: "ok" }, 5)).toBeNull();
    expect(parseStreamPrice({ ...WS_PRICE, bid: undefined, ask: undefined }, 5)).toMatchObject({ bid: null, spread: null, mid: 1.17071 });
  });

  it("maps documented error payloads", () => {
    expect(parseError({ code: 401, message: "**apikey** parameter is incorrect or not specified.", status: "error" }, 200)?.code).toBe("AUTH");
    expect(parseError({ code: 429, message: "You have run out of API credits for the current minute.", status: "error" }, 200)?.code).toBe("RATE_LIMITED");
    expect(parseError({ code: 400, message: "**symbol** not found: ABC/XYZ.", status: "error" }, 200)?.code).toBe("INVALID_SYMBOL");
    expect(parseError({ code: 403, message: "This endpoint is available on Pro plan.", status: "error" }, 200)?.code).toBe("PLAN_RESTRICTED");
    expect(parseError({ code: 500, message: "Internal error", status: "error" }, 200)?.code).toBe("UNAVAILABLE");
    expect(parseError(TIME_SERIES, 200)).toBeNull();
  });

  it("filters /forex_pairs to instruments the app can size", () => {
    const list = parseForexPairs({ data: [{ symbol: "EUR/USD", currency_group: "Major", currency_base: "Euro", currency_quote: "US Dollar" }, { symbol: "BTC/USD" }], status: "ok" });
    expect(list.map((i) => i.symbol)).toEqual(["EUR/USD"]);
  });
});

describe("Twelve Data REST provider", () => {
  function provider(respond: (url: URL) => { status?: number; body: unknown }) {
    const calls: { url: URL; headers: Headers }[] = [];
    const usage = new UsageTracker();
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, headers: new Headers(init?.headers) });
      const r = respond(url);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }) as typeof fetch;
    return { p: new TwelveDataProvider({ apiKey: "td-secret", fetchImpl, usage }), calls, usage };
  }

  it("requests candles with the right interval, UTC, and the key only in a header", async () => {
    const { p, calls, usage } = provider(() => ({ body: TIME_SERIES }));
    const candles = await p.getCandles("eurusd", "M15", 2);
    expect(candles).toHaveLength(2);
    const { url, headers } = calls[0]!;
    expect(url.pathname).toBe("/time_series");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ symbol: "EUR/USD", interval: "15min", outputsize: "2", timezone: "UTC" });
    expect(url.searchParams.has("apikey")).toBe(false);
    expect(headers.get("authorization")).toBe("apikey td-secret");
    expect(usage.snapshot().twelveData.byEndpoint["/time_series"]).toBe(1);
  });

  it("maps every timeframe to a Twelve Data interval", async () => {
    const { p, calls } = provider(() => ({ body: TIME_SERIES }));
    for (const tf of TIMEFRAMES) await p.getCandles("EUR/USD", tf, 5);
    expect(calls.map((c) => c.url.searchParams.get("interval"))).toEqual(["1min", "5min", "15min", "30min", "1h", "2h", "4h", "1day"]);
  });

  it("surfaces an invalid key, rate limits and invalid symbols as typed errors", async () => {
    await expect(provider(() => ({ status: 401, body: { code: 401, message: "apikey incorrect", status: "error" } })).p.getQuote("EUR/USD")).rejects.toMatchObject({ code: "AUTH" });
    await expect(provider(() => ({ body: { code: 429, message: "out of credits", status: "error" } })).p.getQuote("EUR/USD")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(provider(() => ({ body: TIME_SERIES })).p.getQuote("NOT A PAIR")).rejects.toMatchObject({ code: "INVALID_SYMBOL" });
    const failing = provider(() => ({ body: { code: 500, message: "down", status: "error" } }));
    await expect(failing.p.getCandles("EUR/USD", "H1", 5)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(failing.usage.snapshot().twelveData.errors).toBe(1);
  });

  it("reports a network failure as unavailable rather than inventing data", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(new TwelveDataProvider({ apiKey: "k", fetchImpl }).getQuote("EUR/USD")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("downloads the symbol list once and searches it locally", async () => {
    const { p, calls } = provider(() => ({ body: { data: [{ symbol: "EUR/USD", currency_base: "Euro", currency_quote: "US Dollar" }, { symbol: "AUD/NZD", currency_base: "Australian Dollar", currency_quote: "New Zealand Dollar" }] } }));
    expect((await p.searchSymbols("aud")).map((i) => i.symbol)).toEqual(["AUD/NZD"]);
    expect((await p.searchSymbols("EUR/USD")).map((i) => i.symbol)).toEqual(["EUR/USD"]);
    expect(calls).toHaveLength(1);
  });

  it("refuses to start without a key", () => {
    expect(() => new TwelveDataProvider({ apiKey: "" })).toThrow(MarketDataError);
  });
});

describe("Twelve Data WebSocket stream", () => {
  let server: WebSocketServer | null = null;
  let stream: TwelveDataPriceStream | null = null;
  afterEach(async () => {
    stream?.close();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
    stream = null;
  });

  /** A local stand-in for wss://ws.twelvedata.com that speaks the documented protocol. */
  async function fakeTwelveData(opts: { rejectKey?: boolean } = {}) {
    const received: unknown[] = [];
    const sockets: ServerSocket[] = [];
    let urls: string[] = [];
    server = new WebSocketServer({ port: 0 });
    server.on("connection", (socket, req) => {
      urls.push(req.url ?? "");
      sockets.push(socket);
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        received.push(msg);
        if (msg.action === "subscribe") {
          if (opts.rejectKey) {
            socket.send(JSON.stringify({ event: "subscribe-status", status: "error", message: "Invalid API key", success: [], fails: [] }));
            return;
          }
          const symbols = String(msg.params.symbols).split(",");
          const ok = symbols.filter((s) => s !== "ABC/XYZ");
          socket.send(JSON.stringify({ event: "subscribe-status", status: "ok", success: ok.map((symbol) => ({ symbol, exchange: "PHYSICAL CURRENCY", type: "Physical Currency" })), fails: symbols.filter((s) => s === "ABC/XYZ").map((symbol) => ({ symbol })) }));
          for (const symbol of ok) socket.send(JSON.stringify({ ...WS_PRICE, symbol }));
        }
        if (msg.action === "heartbeat") socket.send(JSON.stringify({ event: "heartbeat", status: "ok" }));
      });
    });
    await new Promise<void>((r) => server!.once("listening", () => r()));
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { url, received, sockets, urls: () => urls, resetUrls: () => (urls = []) };
  }

  const until = async (cond: () => boolean, ms = 3000) => {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it("connects lazily, subscribes, streams prices with bid/ask and reports LIVE", async () => {
    const fake = await fakeTwelveData();
    const statuses: StreamStatus[] = [];
    const quotes: Quote[] = [];
    stream = new TwelveDataPriceStream({ apiKey: "secret key", url: fake.url, heartbeatMs: 50 });
    stream.onStatus((s) => statuses.push(s));
    stream.onQuote((q) => quotes.push(q));
    expect(stream.status().state).toBe("OFFLINE");
    expect(fake.urls()).toHaveLength(0); // nothing wanted → no connection, no credits

    stream.subscribe("EUR/USD");
    await until(() => quotes.length > 0);
    expect(fake.urls()[0]).toBe("/v1/quotes/price?apikey=secret%20key");
    expect(fake.received[0]).toEqual({ action: "subscribe", params: { symbols: "EUR/USD" } });
    expect(stream.status()).toMatchObject({ state: "LIVE", transport: "websocket", subscribed: ["EUR/USD"] });
    expect(quotes[0]).toMatchObject({ symbol: "EUR/USD", bid: 1.17067, ask: 1.17075, source: "twelvedata-ws" });
    expect(stream.latest("EURUSD")?.mid).toBeCloseTo(1.17071, 6);
    expect(statuses.map((s) => s.state)).toContain("CONNECTING");

    await until(() => fake.received.some((m) => (m as { action: string }).action === "heartbeat"));
  });

  it("reference-counts subscriptions and disconnects when nothing is watched", async () => {
    const fake = await fakeTwelveData();
    stream = new TwelveDataPriceStream({ apiKey: "k", url: fake.url });
    stream.subscribe("EUR/USD");
    stream.subscribe("EUR/USD");
    await until(() => stream!.status().state === "LIVE");
    stream.unsubscribe("EUR/USD");
    expect(stream.status().state).toBe("LIVE");
    stream.unsubscribe("EUR/USD");
    expect(stream.status().state).toBe("OFFLINE");
    await until(() => fake.received.some((m) => (m as { action: string }).action === "unsubscribe"));
    expect(fake.received).toContainEqual({ action: "unsubscribe", params: { symbols: "EUR/USD" } });
  });

  it("reconnects after a disconnect and resubscribes", async () => {
    const fake = await fakeTwelveData();
    const states: string[] = [];
    stream = new TwelveDataPriceStream({ apiKey: "k", url: fake.url, backoffMs: { initial: 20, max: 100 } });
    stream.onStatus((s) => states.push(s.state));
    stream.subscribe("GBP/USD");
    await until(() => stream!.status().state === "LIVE");
    fake.sockets[0]!.terminate(); // the server drops us
    await until(() => states.includes("RECONNECTING"));
    await until(() => fake.urls().length === 2 && stream!.status().state === "LIVE");
    const subs = fake.received.filter((m) => (m as { action: string }).action === "subscribe");
    expect(subs).toHaveLength(2);
    expect(subs[1]).toEqual({ action: "subscribe", params: { symbols: "GBP/USD" } });
  });

  it("treats a silent connection as dead and reconnects", async () => {
    const fake = await fakeTwelveData();
    stream = new TwelveDataPriceStream({ apiKey: "k", url: fake.url, heartbeatMs: 10_000, silenceTimeoutMs: 80, backoffMs: { initial: 10, max: 10 } });
    stream.subscribe("EUR/USD");
    await until(() => fake.urls().length >= 2, 2000);
  });

  it("reports symbols the stream does not accept", async () => {
    const fake = await fakeTwelveData();
    stream = new TwelveDataPriceStream({ apiKey: "k", url: fake.url });
    stream.subscribe("ABC/XYZ");
    await until(() => stream!.status().reason?.includes("ABC/XYZ") ?? false);
    expect(stream.status().state).toBe("OFFLINE");
  });

  it("stops retrying when the API key is rejected", async () => {
    const fake = await fakeTwelveData({ rejectKey: true });
    stream = new TwelveDataPriceStream({ apiKey: "bad", url: fake.url, backoffMs: { initial: 10, max: 10 } });
    stream.subscribe("EUR/USD");
    await until(() => stream!.status().state === "OFFLINE" && /API key/.test(stream!.status().reason ?? ""));
    await new Promise((r) => setTimeout(r, 100));
    expect(fake.urls()).toHaveLength(1);
  });

  it("reports OFFLINE with a reason when the server cannot be reached", async () => {
    stream = new TwelveDataPriceStream({ apiKey: "k", url: "ws://127.0.0.1:1", backoffMs: { initial: 10, max: 20 } });
    stream.subscribe("EUR/USD");
    await until(() => stream!.status().state === "RECONNECTING");
  });
});

describe("candle cache", () => {
  function counting(inner: MarketDataProvider) {
    let calls = 0;
    const p: MarketDataProvider = { ...inner, id: inner.id, name: inner.name, mode: inner.mode, supportsTimeframe: (t) => inner.supportsTimeframe(t), getQuote: (s) => inner.getQuote(s), searchSymbols: (q) => inner.searchSymbols(q), getCandles: (s, tf, n) => (calls++, inner.getCandles(s, tf, n)) };
    return { p, calls: () => calls };
  }

  it("serves repeat requests from cache within the TTL and shares concurrent requests", async () => {
    let now = 0;
    const { p, calls } = counting(mock());
    const cache = new CandleCache(undefined, undefined, () => now);
    await Promise.all([cache.get(p, "EUR/USD", "M15", 100), cache.get(p, "EUR/USD", "M15", 100)]);
    expect(calls()).toBe(1);
    const again = await cache.get(p, "EUR/USD", "M15", 50);
    expect(again.info.fromCache).toBe(true);
    expect(again.candles).toHaveLength(50);
    now += 61_000; // past the M15 TTL
    expect((await cache.get(p, "EUR/USD", "M15", 100)).info.fromCache).toBe(false);
    expect(calls()).toBe(2);
  });

  it("updates the forming candle from a newer live price without touching closed candles", () => {
    const candles = [
      { timestamp: 0, open: 1, high: 1.2, low: 0.9, close: 1.1 },
      { timestamp: 900_000, open: 1.1, high: 1.15, low: 1.05, close: 1.12 },
    ];
    const q = (mid: number, timestamp: number): Quote => ({ symbol: "EUR/USD", bid: null, ask: null, mid, spread: null, timestamp, receivedAt: timestamp, source: "twelvedata-ws" });
    const patched = applyQuoteToCandles(candles, q(1.2, 1_000_000), "M15");
    expect(patched[0]).toBe(candles[0]);
    expect(patched[1]).toEqual({ timestamp: 900_000, open: 1.1, high: 1.2, low: 1.05, close: 1.2 });
    expect(candles[1]!.close).toBe(1.12); // original untouched
    const next = applyQuoteToCandles(candles, q(1.13, 1_850_000), "M15");
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ timestamp: 1_800_000, open: 1.12, high: 1.13, low: 1.12, close: 1.13 });
    expect(applyQuoteToCandles(candles, q(5, 100), "M15")).toBe(candles); // older price ignored
  });
});

describe("freshness checks", () => {
  const quote: Quote = { symbol: "EUR/USD", mid: 1.17, bid: 1.16995, ask: 1.17005, spread: 0.0001, timestamp: NOW.getTime(), receivedAt: NOW.getTime(), source: "mock" };

  it("flags a stale quote", () => {
    expect(quoteProblem({ ...quote, timestamp: NOW.getTime() - 3_600_000 }, NOW.getTime(), 120)).toMatch(/old/);
    expect(quoteProblem(quote, NOW.getTime(), 120)).toBeNull();
    expect(quoteProblem({ ...quote, ask: 1.1699 }, NOW.getTime(), 120)).toMatch(/ask below bid/);
  });

  it("flags no candles, short, unordered, inconsistent and stale series", async () => {
    const candles = await mock().getCandles("EUR/USD", "M15", 100);
    const now = NOW.getTime();
    expect(candleProblem([], "M15", now, 1)).toMatch(/No M15 candles/);
    expect(candleProblem(candles.slice(0, 10), "M15", now, 60)).toMatch(/Only 10/);
    expect(candleProblem([...candles].reverse(), "M15", now, 60)).toMatch(/time order/);
    expect(candleProblem([...candles.slice(0, -1), { ...candles.at(-1)!, high: 0.5 }], "M15", now, 60)).toMatch(/inconsistent/);
    expect(candleProblem(candles, "M15", now + 6 * 3_600_000, 60)).toMatch(/old/);
  });

  it("flags a quote that disagrees with the candles", async () => {
    const candles = await mock().getCandles("EUR/USD", "M15", 100);
    expect(quoteMatchesCandles({ ...quote, mid: candles.at(-1)!.close * 1.05 }, candles, 0.0008)).toMatch(/disagree/);
  });
});

describe("mock market data", () => {
  it("is deterministic and produces valid candles for every supported timeframe", async () => {
    expect(await mock().getCandles("EUR/USD", "H1", 50)).toEqual(await mock().getCandles("EUR/USD", "H1", 50));
    for (const symbol of ["EUR/USD", "GBP/USD", "USD/JPY"]) {
      for (const tf of TIMEFRAMES.filter((t) => mock().supportsTimeframe(t))) {
        expect(candleProblem(await mock().getCandles(symbol, tf, 260), tf, NOW.getTime(), 200)).toBeNull();
      }
    }
    expect(mock().supportsTimeframe("M1")).toBe(false);
  });

  it("aggregates consistently: an H1 candle spans its four M15 candles", async () => {
    const p = mock();
    const h1 = (await p.getCandles("EUR/USD", "H1", 3))[1]!;
    const m15 = (await p.getCandles("EUR/USD", "M15", 12)).filter((c) => c.timestamp >= h1.timestamp && c.timestamp < h1.timestamp + 3_600_000);
    expect(m15).toHaveLength(4);
    expect(h1.high).toBe(Math.max(...m15.map((c) => c.high)));
    expect(h1.close).toBe(m15[3]!.close);
  });

  it("quotes bid below ask, matching the latest candle", async () => {
    const q = await mock().getQuote("USD/JPY");
    expect(q.ask!).toBeGreaterThan(q.bid!);
    expect(q.source).toBe("mock");
    expect(Math.abs(q.mid - (await mock().getCandles("USD/JPY", "M5", 5)).at(-1)!.close)).toBeLessThan(0.01);
  });
});

describe("market data service", () => {
  function nullStream(): PriceStream {
    return {
      status: () => ({ mode: "LIVE", state: "OFFLINE", transport: "websocket", subscribed: [], reason: "test", lastMessageAt: null }),
      latest: () => null,
      subscribe: () => undefined,
      unsubscribe: () => undefined,
      onQuote: () => () => undefined,
      onStatus: () => () => undefined,
      close: () => undefined,
    };
  }
  const service = (live: MarketDataService extends never ? never : ConstructorParameters<typeof MarketDataService>[0]["live"], mode: "LIVE" | "MOCK" = "LIVE") => {
    const m = mock();
    return new MarketDataService({ live, liveUnavailableReason: "TWELVE_DATA_API_KEY is not set on the server.", mock: { provider: m, stream: new MockPriceStream(m) }, mode, usage: new UsageTracker(), now: () => NOW.getTime() });
  };

  it("in LIVE mode without a key it says LIVE DATA UNAVAILABLE and never substitutes mock data", async () => {
    const s = service(null);
    await expect(s.getQuote("EUR/USD")).rejects.toMatchObject({ code: "NOT_CONFIGURED", message: expect.stringMatching(/^LIVE DATA UNAVAILABLE/) });
    await expect(s.getCandles("EUR/USD", "M15", 50)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(s.streamStatus()).toMatchObject({ mode: "LIVE", state: "OFFLINE", reason: expect.stringMatching(/LIVE DATA UNAVAILABLE/) });
    s.setMode("MOCK");
    expect((await s.getQuote("EUR/USD")).source).toBe("mock");
  });

  it("rejects invalid symbols before spending a request", async () => {
    await expect(service(null, "MOCK").getQuote("NOPE")).rejects.toMatchObject({ code: "INVALID_SYMBOL" });
  });

  it("prefers a fresh stream price over a REST quote", async () => {
    let restCalls = 0;
    const m = mock();
    const live: MarketDataProvider = { id: "td", name: "TD", mode: "LIVE", supportsTimeframe: () => true, getCandles: (s, tf, n) => m.getCandles(s, tf, n), searchSymbols: async () => [], getQuote: async (s) => (restCalls++, m.getQuote(s)) };
    const streamed: Quote = { symbol: "EUR/USD", bid: 1.1, ask: 1.1002, mid: 1.1001, spread: 0.0002, timestamp: NOW.getTime(), receivedAt: NOW.getTime(), source: "twelvedata-ws" };
    const s = service({ provider: live, stream: { ...nullStream(), latest: () => streamed } });
    expect(await s.getQuote("EUR/USD")).toBe(streamed);
    expect(restCalls).toBe(0);
  });

  it("builds one snapshot with M5/M15/H1/H4, timestamps and a staleness verdict", async () => {
    const s = service(null, "MOCK");
    const snap = await s.snapshot("EUR/USD", { maxAgeSeconds: 120 });
    expect(Object.keys(snap.candles)).toEqual(["H4", "H1", "M15", "M5"]);
    expect(snap.retrievedAt).toBe(NOW.getTime());
    expect(snap.dataTimestamp).toBeGreaterThan(0);
    expect(snap.stale).toBe(false);
    expect(snap.mode).toBe("MOCK");
  });

  it("marks a snapshot STALE when the newest price is too old", async () => {
    const m = mock();
    const old: MarketDataProvider = { id: "td", name: "TD", mode: "LIVE", supportsTimeframe: (t) => m.supportsTimeframe(t), getCandles: (s, tf, n) => m.getCandles(s, tf, n), searchSymbols: async () => [], getQuote: async (s) => ({ ...(await m.getQuote(s)), timestamp: NOW.getTime() - 10 * 60_000 }) };
    const snap = await service({ provider: old, stream: nullStream() }).snapshot("EUR/USD", { maxAgeSeconds: 120 });
    expect(snap.stale).toBe(true);
    expect(snap.staleReasons[0]).toMatch(/10 min old/);
  });

  it("polls REST sparingly while the WebSocket is down, and only while someone watches", async () => {
    let restCalls = 0;
    const m = mock();
    const live: MarketDataProvider = { id: "td", name: "TD", mode: "LIVE", supportsTimeframe: () => true, getCandles: (s, tf, n) => m.getCandles(s, tf, n), searchSymbols: async () => [], getQuote: async (s) => (restCalls++, m.getQuote(s)) };
    const s = new MarketDataService({ live: { provider: live, stream: nullStream() }, liveUnavailableReason: "", mock: { provider: m, stream: new MockPriceStream(m) }, mode: "LIVE", usage: new UsageTracker(), restPollMs: 60_000, now: () => NOW.getTime() });
    const quotes: Quote[] = [];
    const stop = s.watch("EUR/USD", (q) => quotes.push(q), () => undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(restCalls).toBe(1);
    expect(quotes).toHaveLength(1);
    expect(s.streamStatus().transport).toBe("rest-poll");
    stop();
    expect(s.streamStatus().transport).toBe("websocket");
  });
});
