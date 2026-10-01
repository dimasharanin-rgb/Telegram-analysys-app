import { describe, expect, it } from "vitest";
import type { Candle, MarketDataSnapshot } from "@/shared/types/market";
import { TIMEFRAME_SECONDS, type Timeframe } from "@/shared/types/trade";
import { MockMarketDataProvider } from "@/data/mock/mockProvider";
import type { MarketDataProvider } from "@/data/types";
import { scanMarket, timeframesFor } from "@/scanner/scanService";
import { detectSetups, setupConfig } from "@/setups";
import { analyzeMarketStructure, buildAnalysisSnapshot, classifyMomentum, DEFAULT_TECHNICAL_CONFIG, trendState } from "@/technical";
import { analyzeTimeframe } from "@/technical/analyze";

const END = Date.UTC(2026, 8, 30, 12);

/** A trending wave: drift per bar plus a sine swing, ending `phase` bars into the cycle. Oldest first, last bar opens before END. */
function wave(tf: Timeframe, drift: number, amp: number, phase: number, n = 260): Candle[] {
  const ms = TIMEFRAME_SECONDS[tf] * 1000;
  const price = (k: number) => 1.1 + drift * k + amp * Math.sin(((k - n + 1 + phase) / 20) * 2 * Math.PI);
  return Array.from({ length: n }, (_, k) => {
    const close = price(k);
    const open = price(k - 1);
    return { timestamp: END - (n - k) * ms, open, high: Math.max(open, close) + amp * 0.05, low: Math.min(open, close) - amp * 0.05, close };
  });
}

/** Mirror image (price → 2.2 − price): turns a bullish market into the equivalent bearish one. */
const mirror = (candles: Candle[]): Candle[] => candles.map((c) => ({ timestamp: c.timestamp, open: 2.2 - c.open, high: 2.2 - c.low, low: 2.2 - c.high, close: 2.2 - c.close }));

function data(candles: Partial<Record<Timeframe, Candle[]>>): MarketDataSnapshot {
  const last = candles.M15!.at(-1)!;
  return {
    symbol: "EUR/USD",
    mode: "LIVE",
    source: "test",
    sourceName: "Test",
    quote: { symbol: "EUR/USD", bid: null, ask: null, mid: last.close, spread: null, timestamp: END, receivedAt: END, source: "twelvedata-rest" },
    candles,
    dataTimestamp: END,
    retrievedAt: END,
    stale: false,
    staleReasons: [],
  };
}

const bullish = (phase = 15) => ({ H4: wave("H4", 0.00064, 0.004, phase), H1: wave("H1", 0.00016, 0.002, phase), M15: wave("M15", 0.00004, 0.001, phase) });

describe("technical state (config-driven, deterministic)", () => {
  it("classifies RSI into configured bands, and the bands are configuration, not code", () => {
    expect([20, 40, 50, 60, 80].map((v) => classifyMomentum(v))).toEqual(["OVERSOLD", "WEAK_BEARISH", "NEUTRAL", "BULLISH", "OVERBOUGHT"]);
    expect(classifyMomentum(65, { ...DEFAULT_TECHNICAL_CONFIG.rsi, overbought: 60 })).toBe("OVERBOUGHT");
    expect(classifyMomentum(null)).toBe("UNKNOWN");
  });

  it("reports EMA alignment and price position as structured facts", () => {
    const base = { rsi14: 50, atr14: 0.001, atrPercent: 0.1, volatility: "NORMAL" as const, volatilityRatio: 1 };
    expect(trendState({ ...base, ema20: 1.12, ema50: 1.11, ema200: 1.1, lastClose: 1.125 })).toMatchObject({ direction: "BULLISH", ema20Above50: true, ema50Above200: true, priceAbove200: true });
    expect(trendState({ ...base, ema20: 1.1, ema50: 1.11, ema200: 1.12, lastClose: 1.09 })).toMatchObject({ direction: "BEARISH", priceAbove200: false });
    expect(trendState({ ...base, ema20: 1.12, ema50: 1.11, ema200: 1.13, lastClose: 1.12 }).direction).toBe("MIXED");
  });

  it("HH → HL → HH → HL is BULLISH, LH → LL → LH → LL is BEARISH, equal swings are RANGE", () => {
    const tf = analyzeTimeframe("M15", wave("M15", 0.00004, 0.001, 15));
    expect(tf.structure.bias).toBe("BULLISH");
    expect(tf.structure.sequence).toHaveLength(4);
    expect(new Set(tf.structure.sequence)).toEqual(new Set(["HH", "HL"]));
    expect(new Set(analyzeTimeframe("M15", mirror(wave("M15", 0.00004, 0.001, 15))).structure.sequence)).toEqual(new Set(["LH", "LL"]));
    expect(analyzeTimeframe("M15", mirror(wave("M15", 0.00004, 0.001, 15))).structure.bias).toBe("BEARISH");
    expect(analyzeTimeframe("M15", wave("M15", 0, 0.001, 15)).structure.bias).toBe("RANGE");
    expect(analyzeMarketStructure([]).bias).toBe("UNCLEAR");
  });

  it("returns every state from one candle series, with levels marked as swing or cluster zones", () => {
    const tf = analyzeTimeframe("H1", wave("H1", 0.00016, 0.002, 15));
    expect(tf.trend.direction).toBe("BULLISH");
    expect(tf.volatility.atr14).toBeGreaterThan(0);
    expect(tf.momentum.state).not.toBe("UNKNOWN");
    for (const l of [...tf.support, ...tf.resistance]) {
      expect(["SWING", "CLUSTER"]).toContain(l.source);
      expect(l.strength).toBe(l.touches);
    }
  });
});

describe("setup detector", () => {
  it("finds a LONG continuation in a bullish market near support/EMA, with reasons and no trade levels", () => {
    const candidates = detectSetups(buildAnalysisSnapshot(data(bullish()), END), setupConfig());
    expect(candidates.length).toBeGreaterThan(0);
    const c = candidates.find((x) => x.setupType === "CONTINUATION" && x.timeframe === "M15")!;
    expect(c).toMatchObject({ symbol: "EUR/USD", direction: "LONG", asOf: END, contextTimeframes: ["H4", "H1"] });
    expect(c.conditions.filter((x) => x.required).every((x) => x.met)).toBe(true);
    expect(c.reasons.length).toBeGreaterThan(0);
    expect(c.invalidationConditions.length).toBeGreaterThan(0);
    expect(c.completeness).toBeGreaterThan(0);
    expect(c.completeness).toBeLessThanOrEqual(1);
    expect(c).not.toHaveProperty("stopLoss");
    expect(c).not.toHaveProperty("takeProfit");
    expect(c).not.toHaveProperty("probability");
    expect(candidates.every((x) => x.direction === "LONG")).toBe(true);
  });

  it("finds the mirrored SHORT continuation in the mirrored bearish market", () => {
    const m = bullish();
    const candidates = detectSetups(buildAnalysisSnapshot(data({ H4: mirror(m.H4), H1: mirror(m.H1), M15: mirror(m.M15) }), END), setupConfig());
    expect(candidates.some((c) => c.direction === "SHORT" && c.setupType === "CONTINUATION")).toBe(true);
    expect(candidates.every((c) => c.direction === "SHORT")).toBe(true);
  });

  it("returns no candidate for a ranging market when directional structure is required", () => {
    const range = { H4: wave("H4", 0, 0.004, 15), H1: wave("H1", 0, 0.002, 15), M15: wave("M15", 0, 0.001, 15) };
    expect(detectSetups(buildAnalysisSnapshot(data(range), END), setupConfig({ allowedSetupTypes: ["CONTINUATION", "PULLBACK"] }))).toEqual([]);
  });

  it("respects the configured filters", () => {
    const snap = buildAnalysisSnapshot(data(bullish()), END);
    expect(detectSetups(snap, setupConfig({ enabled: false }))).toEqual([]);
    expect(detectSetups(snap, setupConfig({ allowedTimeframes: ["H4"] })).every((c) => c.timeframe === "H4")).toBe(true);
    expect(detectSetups(snap, setupConfig({ allowedSymbols: ["GBP/USD"] }))).toEqual([]);
    expect(detectSetups(snap, setupConfig({ minimumAtrPercent: 50 }))).toEqual([]);
    expect(detectSetups(snap, setupConfig({ maxDistanceFromLevelAtr: 0.0001, allowedSetupTypes: ["CONTINUATION"] }))).toEqual([]);
  });

  it("is deterministic: the same snapshot always gives the same candidates", () => {
    const a = detectSetups(buildAnalysisSnapshot(data(bullish()), END), setupConfig());
    const b = detectSetups(buildAnalysisSnapshot(data(bullish()), END), setupConfig());
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("does not use candles after the snapshot time", () => {
    const m = bullish();
    const asOf = m.M15[200]!.timestamp + 15 * 60_000;
    const replay = { includeFormingCandle: false };
    const before = detectSetups(buildAnalysisSnapshot(data(m), asOf, replay), setupConfig());
    const future = { ...m, M15: m.M15.map((c, i) => (i > 200 ? { ...c, open: 5, high: 6, low: 4, close: 5 } : c)) };
    expect(detectSetups(buildAnalysisSnapshot(data(future), asOf, replay), setupConfig())).toEqual(before);
  });

  it("an empty market produces no candidate rather than an error", () => {
    const snap = buildAnalysisSnapshot(data({ M15: [{ timestamp: END - 900_000, open: 1, high: 1, low: 1, close: 1 }], H1: [] }), END);
    expect(detectSetups(snap, setupConfig())).toEqual([]);
  });
});

describe("scanner", () => {
  const NOW = Date.UTC(2026, 8, 30, 11, 2, 30);

  function counting(inner: MarketDataProvider) {
    const calls: string[] = [];
    const p: MarketDataProvider = {
      id: inner.id,
      name: inner.name,
      mode: inner.mode,
      supportsTimeframe: (t) => inner.supportsTimeframe(t),
      searchSymbols: (q) => inner.searchSymbols(q),
      getQuote: (s) => (calls.push(`quote ${s}`), inner.getQuote(s)),
      getCandles: (s, tf, n) => (calls.push(`candles ${s} ${tf}`), inner.getCandles(s, tf, n)),
    };
    return { p, calls };
  }

  it("fetches each timeframe once per symbol and returns unranked candidates (possibly none)", async () => {
    const { p, calls } = counting(new MockMarketDataProvider({ now: () => new Date(NOW) }));
    const result = await scanMarket({ symbols: ["EUR/USD", "GBP/USD"], timeframes: ["M15", "H1"] }, { market: p, now: () => NOW, maxAgeSeconds: 120 });
    expect(result.scannedAt).toBe(NOW);
    expect(result.symbols.map((s) => [s.symbol, s.status])).toEqual([["EUR/USD", "OK"], ["GBP/USD", "OK"]]);
    expect(calls.filter((c) => c.startsWith("candles EUR/USD"))).toEqual(["candles EUR/USD H4", "candles EUR/USD H1", "candles EUR/USD M15"]);
    expect(Array.isArray(result.candidates)).toBe(true);
    for (const c of result.candidates) expect(["M15", "H1"]).toContain(c.timeframe);
  });

  it("asks only for the context the requested timeframes need", () => {
    expect(timeframesFor(["H1"])).toEqual(["H4", "H1"]);
    expect(timeframesFor(["M15"])).toEqual(["H4", "H1", "M15"]);
    expect(timeframesFor(["M5", "H4"])).toEqual(["H4", "H1", "M15", "M5"]);
  });

  it("reports missing, stale or invalid data per symbol instead of analysing it", async () => {
    const mock = new MockMarketDataProvider({ now: () => new Date(NOW) });
    const empty: MarketDataProvider = { ...counting(mock).p, getCandles: async () => [] };
    const r1 = await scanMarket({ symbols: ["EUR/USD"], timeframes: ["M15"] }, { market: empty, now: () => NOW, maxAgeSeconds: 120 });
    expect(r1.symbols[0]).toMatchObject({ status: "UNAVAILABLE", candidates: 0 });
    expect(r1.candidates).toEqual([]);
    const r2 = await scanMarket({ symbols: ["EUR/USD"], timeframes: ["M15"] }, { market: mock, now: () => NOW + 3_600_000, maxAgeSeconds: 120 });
    expect(r2.symbols[0]!.status).toBe("UNAVAILABLE");
    const r3 = await scanMarket({ symbols: ["NOPE"], timeframes: ["M15"] }, { market: mock, now: () => NOW, maxAgeSeconds: 120 });
    expect(r3.symbols[0]).toMatchObject({ status: "UNAVAILABLE", reason: expect.stringMatching(/not a recognised/) });
  });
});
