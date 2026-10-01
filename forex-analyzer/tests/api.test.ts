import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockAnalyst } from "@/ai/mockAnalyst";
import { openDatabase } from "@/journal/db";
import { DEFAULT_SETTINGS } from "@/shared/defaults";
import { MarketDataService } from "@/data/marketDataService";
import { MockMarketDataProvider } from "@/data/mock/mockProvider";
import { MockPriceStream } from "@/data/mock/mockStream";
import { UsageTracker } from "@/data/usage";
import { createApp } from "@/server/app";
import { loadConfig } from "@/server/config";
import { createServices } from "@/server/container";

const NOW = new Date("2026-09-30T11:00:00Z");
/** Mock data, journal-derived account figures. */
const MOCK_SETTINGS = { ...DEFAULT_SETTINGS, dataMode: "MOCK", accountStateSource: "JOURNAL" };
let server: Server;
let base: string;

beforeAll(async () => {
  const config = loadConfig([], { ANTHROPIC_API_KEY: "sk-ant-secret-should-not-leak", TWELVE_DATA_API_KEY: "td-secret-should-not-leak" });
  const mock = new MockMarketDataProvider({ now: () => NOW });
  const services = createServices(config, {
    db: openDatabase(":memory:"),
    market: new MarketDataService({ live: null, liveUnavailableReason: "test", mock: { provider: mock, stream: new MockPriceStream(mock, 50) }, mode: "MOCK", usage: new UsageTracker(), now: () => NOW.getTime() }),
    analyst: new MockAnalyst(),
    now: () => NOW,
  });
  server = createApp(services).listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.close();
});

const json = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

describe("HTTP API", () => {
  it("never returns API keys to the browser", async () => {
    for (const path of ["/status", "/settings", "/account", "/dashboard", "/dev/usage", "/market/snapshot?symbol=EUR/USD"]) {
      const res = await fetch(base + path);
      expect(await res.text()).not.toMatch(/should-not-leak/);
    }
    const { body } = await json("/status");
    expect(body.execution).toBe("disabled");
  });

  it("validates settings and reports field errors", async () => {
    const bad = await json("/settings", { method: "PUT", body: JSON.stringify({ ...MOCK_SETTINGS, accountSize: -1, allowedPairs: ["NOPE"] }) });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(["accountSize", "allowedPairs"]));
    const extra = await json("/settings", { method: "PUT", body: JSON.stringify({ ...MOCK_SETTINGS, anthropicApiKey: "x" }) });
    expect(extra.status).toBe(400);
    const ok = await json("/settings", { method: "PUT", body: JSON.stringify({ ...MOCK_SETTINGS, accountSize: 20_000 }) });
    expect(ok.status).toBe(200);
    expect((await json("/settings")).body.accountSize).toBe(20_000);
    await json("/settings", { method: "PUT", body: JSON.stringify(MOCK_SETTINGS) });
  });

  it("validates trade input", async () => {
    const res = await json("/risk", { method: "POST", body: JSON.stringify({ pair: "EURUSD", direction: "UP", entry: "abc", stopLoss: 1, takeProfit: 2, timeframe: "M2" }) });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields)).toEqual(expect.arrayContaining(["direction", "entry", "timeframe"]));
    const malformed = await fetch(base + "/risk", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(malformed.status).toBe(400);
  });

  it("runs the risk engine and the full analysis, then journals and records the outcome", async () => {
    const quote = (await json("/market/quote?symbol=EUR/USD")).body;
    const entry = +quote.mid.toFixed(5);
    const trade = { pair: "eurusd", direction: "LONG", entry, stopLoss: +(entry - 0.002).toFixed(5), takeProfit: +(entry + 0.0045).toFixed(5), timeframe: "M15" };

    const riskRes = await json("/risk", { method: "POST", body: JSON.stringify(trade) });
    expect(riskRes.status).toBe(200);
    expect(riskRes.body.calculation.suggestedPositionSize).toBe(0.25);

    const analysis = await json("/analyze", { method: "POST", body: JSON.stringify(trade) });
    expect(analysis.status).toBe(200);
    expect(analysis.body.state).toBe("ANALYZED");
    expect(analysis.body.trade.pair).toBe("EUR/USD");
    const id = analysis.body.id as string;

    const list = await json("/journal?pair=EUR/USD");
    expect(list.body.map((e: { id: string }) => e.id)).toContain(id);

    const invalid = await json(`/journal/${id}/outcome`, { method: "PATCH", body: JSON.stringify({ status: "CLOSED", result: null, actualPnl: null, rMultiple: null, notes: "" }) });
    expect(invalid.status).toBe(400);
    const saved = await json(`/journal/${id}/outcome`, { method: "PATCH", body: JSON.stringify({ status: "CLOSED", result: "WIN", actualPnl: 112.5, rMultiple: null, notes: "" }) });
    expect(saved.status).toBe(200);
    expect(saved.body.rMultiple).toBe(2.25);

    const dash = await json("/dashboard");
    expect(dash.body.account.balance).toBe(10_112.5);
    expect(dash.body.stats.wins).toBe(1);
  });

  it("blocks oversized trades without AI analysis", async () => {
    const trade = { pair: "EUR/USD", direction: "LONG", entry: 1.1735, stopLoss: 1.1715, takeProfit: 1.1775, positionSize: 1, timeframe: "M15" };
    const res = await json("/analyze", { method: "POST", body: JSON.stringify(trade) });
    expect(res.body.state).toBe("BLOCKED");
    expect(res.body.ai).toBeNull();
  });

  it("serves quotes, candles, snapshots and symbol search, and rejects invalid symbols", async () => {
    const quote = await json("/market/quote?symbol=USD/JPY");
    expect(quote.body).toMatchObject({ symbol: "USD/JPY", source: "mock" });
    const candles = await json("/market/candles?symbol=EUR/USD&timeframe=H1&limit=50");
    expect(candles.body.candles).toHaveLength(50);
    expect(candles.body.candles[0]).toHaveProperty("timestamp");
    const snap = await json("/market/snapshot?symbol=EUR/USD");
    expect(Object.keys(snap.body.candles)).toEqual(["H4", "H1", "M15", "M5"]);
    expect(snap.body).toMatchObject({ mode: "MOCK", stale: false });
    expect(typeof snap.body.dataTimestamp).toBe("number");
    expect(typeof snap.body.retrievedAt).toBe("number");
    expect((await json("/market/search?q=gbp")).body.map((i: { symbol: string }) => i.symbol)).toContain("GBP/USD");
    const bad = await json("/market/quote?symbol=FOO/BAR");
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_SYMBOL");
    expect((await json("/market/candles?symbol=EUR/USD&timeframe=M2")).status).toBe(400);
  });

  it("streams live prices to the browser over server-sent events", async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/stream?symbol=EUR/USD`, { signal: controller.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("event: quote")) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    expect(text).toMatch(/event: status\ndata: \{"mode":"MOCK"/);
    expect(text).toMatch(/"symbol":"EUR\/USD"/);
  });

  it("returns 404 for unknown entries and routes", async () => {
    expect((await json("/journal/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await json("/journal/not-a-uuid")).status).toBe(400);
    expect((await json("/nope")).status).toBe(404);
  });
});

describe("LIVE mode", () => {
  async function start(env: Record<string, string>, fetchImpl?: typeof fetch) {
    const services = createServices(loadConfig([], env), { db: openDatabase(":memory:"), analyst: new MockAnalyst(), fetchImpl });
    const srv = createApp(services).listen(0);
    await new Promise<void>((r) => srv.once("listening", () => r()));
    return { srv, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`, services };
  }

  it("without a Twelve Data key says LIVE DATA UNAVAILABLE instead of serving mock data", async () => {
    const { srv, url } = await start({});
    try {
      const status = await (await fetch(url + "/status")).json();
      expect(status).toMatchObject({ dataMode: "LIVE", liveConfigured: false });
      const res = await fetch(url + "/market/quote?symbol=EUR/USD");
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/^LIVE DATA UNAVAILABLE/);
    } finally {
      srv.close();
    }
  });

  it("with a key reads candles from Twelve Data through the server", async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (input: string | URL) => {
      const u = new URL(String(input));
      urls.push(u);
      return new Response(JSON.stringify({ meta: { symbol: "EUR/USD" }, values: [{ datetime: "2026-09-30 10:00:00", open: "1.1", high: "1.2", low: "1.0", close: "1.15" }], status: "ok" }));
    }) as typeof fetch;
    const { srv, url } = await start({ TWELVE_DATA_API_KEY: "td-key", TWELVE_DATA_WS_URL: "ws://127.0.0.1:1" }, fetchImpl);
    try {
      const body = await (await fetch(url + "/market/candles?symbol=EUR/USD&timeframe=H1&limit=10")).json();
      expect(body.candles).toEqual([{ timestamp: Date.UTC(2026, 8, 30, 10), open: 1.1, high: 1.2, low: 1.0, close: 1.15 }]);
      expect(urls[0]!.hostname).toBe("api.twelvedata.com");
      // the same request again is served from the cache
      await fetch(url + "/market/candles?symbol=EUR/USD&timeframe=H1&limit=10");
      expect(urls).toHaveLength(1);
      const usage = await (await fetch(url + "/dev/usage")).json();
      expect(usage.usage.twelveData.requests).toBe(1);
      expect(usage.usage.cache.hits).toBe(1);
    } finally {
      srv.close();
    }
  });
});

describe("deterministic scan endpoint", () => {
  it("scans without ever calling the AI analyst, and serves market context", async () => {
    let aiCalls = 0;
    const spy = { provider: "anthropic" as const, model: "spy", analyze: async () => { aiCalls++; throw new Error("must not be called"); } };
    const NOW2 = new Date("2026-09-30T11:00:00Z");
    const m = new MockMarketDataProvider({ now: () => NOW2 });
    const services = createServices(loadConfig([], {}), {
      db: openDatabase(":memory:"),
      analyst: spy,
      now: () => NOW2,
      market: new MarketDataService({ live: null, liveUnavailableReason: "test", mock: { provider: m, stream: new MockPriceStream(m) }, mode: "MOCK", usage: new UsageTracker(), now: () => NOW2.getTime() }),
    });
    const srv = createApp(services).listen(0);
    await new Promise<void>((r) => srv.once("listening", () => r()));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`;
    try {
      const res = await fetch(url + "/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols: ["EUR/USD", "usdjpy"], timeframes: ["M15", "H1"] }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.symbols.map((s: { symbol: string }) => s.symbol)).toEqual(["EUR/USD", "USD/JPY"]);
      expect(Array.isArray(body.candidates)).toBe(true);
      expect(aiCalls).toBe(0);
      expect(services.usage.snapshot().claude.requests).toBe(0);

      const bad = await fetch(url + "/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols: ["EUR/USD"], config: { stopLoss: 1 } }) });
      expect(bad.status).toBe(400);

      const ctx = await (await fetch(url + "/market/context?symbol=EUR/USD")).json();
      expect(ctx.timeframes.map((t: { timeframe: string }) => t.timeframe)).toEqual(["H4", "H1", "M15", "M5"]);
      expect(ctx.timeframes[0]).toHaveProperty("trend.direction");
      expect(ctx.timeframes[0]).not.toHaveProperty("candles");
      expect(aiCalls).toBe(0);
    } finally {
      srv.close();
    }
  });
});
