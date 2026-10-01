import { describe, expect, it } from "vitest";
import { CachedMarketDataProvider } from "@/services/market/cachedProvider";
import { candleProblem, quoteMatchesCandles, quoteProblem } from "@/services/market/freshness";
import { MockMarketDataProvider } from "@/services/market/mockProvider";
import { TwelveDataProvider } from "@/services/market/twelveDataProvider";
import { MarketDataError } from "@/services/market/types";
import { TIMEFRAMES } from "@/types/trade";

const NOW = new Date("2026-09-30T11:02:30Z");
const mock = () => new MockMarketDataProvider({ now: () => NOW });

describe("mock market data", () => {
  it("is deterministic for the same moment", async () => {
    expect(await mock().getCandles("EURUSD", "H1", 50)).toEqual(await mock().getCandles("EURUSD", "H1", 50));
    expect(await mock().getCurrentPrice("XAUUSD")).toEqual(await mock().getCurrentPrice("XAUUSD"));
  });

  it("produces valid, ordered, current candles for every timeframe and demo instrument", async () => {
    for (const pair of ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"]) {
      for (const tf of TIMEFRAMES) {
        const candles = await mock().getCandles(pair, tf, 260);
        expect(candles).toHaveLength(260);
        expect(candleProblem(candles, tf, NOW, 200)).toBeNull();
      }
    }
  });

  it("aggregates consistently: an H1 candle spans its four M15 candles", async () => {
    const p = mock();
    const h1 = (await p.getCandles("EURUSD", "H1", 3))[1]!;
    const m15 = (await p.getCandles("EURUSD", "M15", 12)).filter((c) => c.time >= h1.time && c.time < h1.time + 3600);
    expect(m15).toHaveLength(4);
    expect(h1.open).toBe(m15[0]!.open);
    expect(h1.close).toBe(m15[3]!.close);
    expect(h1.high).toBe(Math.max(...m15.map((c) => c.high)));
    expect(h1.low).toBe(Math.min(...m15.map((c) => c.low)));
  });

  it("quotes a realistic price with bid below ask, matching the latest candle", async () => {
    const p = mock();
    const q = await p.getCurrentPrice("USDJPY");
    expect(q.price).toBeGreaterThan(100);
    expect(q.ask!).toBeGreaterThan(q.bid!);
    expect(q.spread).toBeGreaterThan(0);
    const candles = await p.getCandles("USDJPY", "M5", 30);
    expect(q.price).toBe(candles.at(-1)!.close);
    expect(quoteProblem(q, NOW, 300)).toBeNull();
  });

  it("rejects instruments it does not know", async () => {
    await expect(mock().getCandles("ABCDEF", "H1", 10)).rejects.toBeInstanceOf(MarketDataError);
  });
});

describe("freshness checks", () => {
  const quote = { pair: "EURUSD", price: 1.17, bid: 1.16995, ask: 1.17005, spread: 0.0001, timestamp: NOW.getTime(), source: "t" };

  it("flags a stale quote", () => {
    expect(quoteProblem({ ...quote, timestamp: NOW.getTime() - 3_600_000 }, NOW, 300)).toMatch(/old/);
    expect(quoteProblem({ ...quote, ask: 1.1699 }, NOW, 300)).toMatch(/ask below bid/);
  });

  it("flags short, unordered, inconsistent and stale candle series", async () => {
    const candles = await mock().getCandles("EURUSD", "M15", 100);
    expect(candleProblem(candles.slice(0, 10), "M15", NOW, 60)).toMatch(/Only 10/);
    expect(candleProblem([...candles].reverse(), "M15", NOW, 60)).toMatch(/time order/);
    expect(candleProblem([...candles.slice(0, -1), { ...candles.at(-1)!, high: 0.5 }], "M15", NOW, 60)).toMatch(/inconsistent/);
    expect(candleProblem(candles, "M15", new Date(NOW.getTime() + 6 * 3_600_000), 60)).toMatch(/old/);
  });

  it("flags a quote that disagrees with the candles", async () => {
    const candles = await mock().getCandles("EURUSD", "M15", 100);
    expect(quoteMatchesCandles({ ...quote, price: candles.at(-1)!.close * 1.05 }, candles, 0.0008)).toMatch(/disagree/);
  });
});

describe("Twelve Data provider", () => {
  function provider(body: unknown, status = 200) {
    const calls: { url: URL; headers: Headers }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: new URL(String(url)), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { p: new TwelveDataProvider({ apiKey: "td-secret", fetchImpl }), calls };
  }

  it("maps symbols and intervals, keeps the key in a header, and parses candles", async () => {
    const { p, calls } = provider({
      status: "ok",
      values: [
        { datetime: "2026-09-30 10:45:00", open: "1.17010", high: "1.17060", low: "1.17000", close: "1.17050" },
        { datetime: "2026-09-30 11:00:00", open: "1.17050", high: "1.17080", low: "1.17020", close: "1.17070" },
      ],
    });
    const candles = await p.getCandles("EURUSD", "M15", 2);
    expect(calls[0]!.url.pathname).toBe("/time_series");
    expect(calls[0]!.url.searchParams.get("symbol")).toBe("EUR/USD");
    expect(calls[0]!.url.searchParams.get("interval")).toBe("15min");
    expect(calls[0]!.url.searchParams.has("apikey")).toBe(false);
    expect(calls[0]!.headers.get("authorization")).toBe("apikey td-secret");
    expect(candles[1]).toEqual({ time: Date.UTC(2026, 8, 30, 11) / 1000, open: 1.1705, high: 1.1708, low: 1.1702, close: 1.1707 });
  });

  it("parses daily candles and quotes, reporting the spread as unknown", async () => {
    const daily = await provider({ values: [{ datetime: "2026-09-30", open: "3850", high: "3870", low: "3840", close: "3860" }] }).p.getCandles("XAUUSD", "D1", 1);
    expect(daily[0]!.time).toBe(Date.UTC(2026, 8, 30) / 1000);
    const { p, calls } = provider({ symbol: "XAU/USD", close: "3860.25", timestamp: 1790766000 });
    const q = await p.getCurrentPrice("XAUUSD");
    expect(calls[0]!.url.searchParams.get("symbol")).toBe("XAU/USD");
    expect(q).toMatchObject({ price: 3860.25, spread: null, bid: null, ask: null, timestamp: 1790766000 * 1000 });
  });

  it("maps provider errors", async () => {
    await expect(provider({ status: "error", code: 429, message: "limit" }).p.getCandles("EURUSD", "H1", 5)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(provider({ status: "error", code: 400, message: "bad symbol" }).p.getCandles("EURUSD", "H1", 5)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(provider({ values: [] }).p.getCandles("EURUSD", "H1", 5)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    await expect(provider({ close: "x" }).p.getCurrentPrice("EURUSD")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("refuses to start without a key", () => {
    expect(() => new TwelveDataProvider({ apiKey: "" })).toThrow(MarketDataError);
  });
});

describe("cached provider", () => {
  it("reuses a recent answer instead of calling the provider again", async () => {
    let calls = 0;
    const inner = mock();
    const counting = { ...inner, id: "c", name: "c", isMock: true, supportsTimeframe: () => true, getCandles: (p: string, tf: "H1", n: number) => inner.getCandles(p, tf, n), getCurrentPrice: (p: string) => (calls++, inner.getCurrentPrice(p)) };
    const cached = new CachedMarketDataProvider(counting);
    await cached.getCurrentPrice("EURUSD");
    await cached.getCurrentPrice("EURUSD");
    expect(calls).toBe(1);
  });
});
