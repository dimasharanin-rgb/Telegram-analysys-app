import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockAnalyst } from "@/ai/mockAnalyst";
import { openDatabase } from "@/database/client";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { MockMarketDataProvider } from "@/services/market/mockProvider";
import { createApp } from "@/server/app";
import { loadConfig } from "@/server/config";
import { createServices } from "@/server/container";

const NOW = new Date("2026-09-30T11:00:00Z");
let server: Server;
let base: string;

beforeAll(async () => {
  const config = loadConfig([], { ANTHROPIC_API_KEY: "sk-ant-secret-should-not-leak", MARKET_DATA_API_KEY: "md-secret-should-not-leak", MARKET_DATA_PROVIDER: "mock" });
  const services = createServices(config, {
    db: openDatabase(":memory:"),
    market: new MockMarketDataProvider({ now: () => NOW }),
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
    for (const path of ["/status", "/settings", "/account", "/dashboard"]) {
      const res = await fetch(base + path);
      expect(await res.text()).not.toMatch(/should-not-leak/);
    }
    const { body } = await json("/status");
    expect(body.execution).toBe("disabled");
  });

  it("validates settings and reports field errors", async () => {
    const bad = await json("/settings", { method: "PUT", body: JSON.stringify({ ...DEFAULT_SETTINGS, accountSize: -1, allowedPairs: ["NOPE"] }) });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(["accountSize", "allowedPairs"]));
    const extra = await json("/settings", { method: "PUT", body: JSON.stringify({ ...DEFAULT_SETTINGS, anthropicApiKey: "x" }) });
    expect(extra.status).toBe(400);
    const ok = await json("/settings", { method: "PUT", body: JSON.stringify({ ...DEFAULT_SETTINGS, accountSize: 20_000 }) });
    expect(ok.status).toBe(200);
    expect((await json("/settings")).body.accountSize).toBe(20_000);
    await json("/settings/reset", { method: "POST", body: "{}" });
  });

  it("validates trade input", async () => {
    const res = await json("/risk", { method: "POST", body: JSON.stringify({ pair: "EURUSD", direction: "UP", entry: "abc", stopLoss: 1, takeProfit: 2, timeframe: "M1" }) });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields)).toEqual(expect.arrayContaining(["direction", "entry", "timeframe"]));
    const malformed = await fetch(base + "/risk", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(malformed.status).toBe(400);
  });

  it("runs the risk engine and the full analysis, then journals and records the outcome", async () => {
    const quote = (await json("/market/quote?pair=EURUSD")).body.quote;
    const trade = { pair: "eur/usd", direction: "LONG", entry: quote.price, stopLoss: +(quote.price - 0.002).toFixed(5), takeProfit: +(quote.price + 0.0045).toFixed(5), timeframe: "M15" };

    const riskRes = await json("/risk", { method: "POST", body: JSON.stringify(trade) });
    expect(riskRes.status).toBe(200);
    expect(riskRes.body.calculation.suggestedPositionSize).toBe(0.25);

    const analysis = await json("/analyze", { method: "POST", body: JSON.stringify(trade) });
    expect(analysis.status).toBe(200);
    expect(analysis.body.state).toBe("ANALYZED");
    expect(analysis.body.trade.pair).toBe("EURUSD");
    const id = analysis.body.id as string;

    const list = await json("/journal?pair=EURUSD");
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
    const trade = { pair: "EURUSD", direction: "LONG", entry: 1.1735, stopLoss: 1.1715, takeProfit: 1.1775, positionSize: 1, timeframe: "M15" };
    const res = await json("/analyze", { method: "POST", body: JSON.stringify(trade) });
    expect(res.body.state).toBe("BLOCKED");
    expect(res.body.ai).toBeNull();
  });

  it("returns 404 for unknown entries and routes", async () => {
    expect((await json("/journal/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await json("/journal/not-a-uuid")).status).toBe(400);
    expect((await json("/nope")).status).toBe(404);
  });
});
