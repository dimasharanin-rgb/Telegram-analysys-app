import { describe, expect, it } from "vitest";
import type { Candle, MarketDataSnapshot } from "@/shared/types/market";
import { candlesKnownAt } from "@/shared/candleTime";
import { collectMarketData } from "@/data/collect";
import { MarketDataService } from "@/data/marketDataService";
import { MockMarketDataProvider } from "@/data/mock/mockProvider";
import { MockPriceStream } from "@/data/mock/mockStream";
import { parseTimeSeries } from "@/data/twelvedata/normalize";
import { UsageTracker } from "@/data/usage";
import { atr, buildAnalysisSnapshot, ema, rsi } from "@/technical";

const NOW = Date.UTC(2026, 8, 30, 11, 2, 30);
const HOUR = 3_600_000;
const mock = () => new MockMarketDataProvider({ now: () => new Date(NOW) });

/** Plain normalised candles, hourly, no provider involved. */
function hourly(n: number, start = Date.UTC(2026, 8, 1)): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 1.1 + Math.sin(i / 7) * 0.01 + i * 0.0001;
    return { timestamp: start + i * HOUR, open: close - 0.0002, high: close + 0.0008, low: close - 0.0009, close };
  });
}

function dataSnapshot(candles: Candle[]): MarketDataSnapshot {
  const last = candles.at(-1)!;
  return {
    symbol: "EUR/USD",
    mode: "LIVE",
    source: "test",
    sourceName: "Test",
    quote: { symbol: "EUR/USD", bid: null, ask: null, mid: last.close, spread: null, timestamp: last.timestamp, receivedAt: last.timestamp, source: "twelvedata-rest" },
    candles: { H1: candles },
    dataTimestamp: last.timestamp,
    retrievedAt: last.timestamp + 1000,
    stale: false,
    staleReasons: [],
  };
}

describe("normalised market data", () => {
  it("keeps volume when the provider reports it and omits it otherwise", () => {
    const [withVolume, without] = parseTimeSeries({
      values: [
        { datetime: "2026-09-30 10:00:00", open: "1", high: "2", low: "0.5", close: "1.5", volume: "1200" },
        { datetime: "2026-09-30 11:00:00", open: "1", high: "2", low: "0.5", close: "1.5" },
      ],
    });
    expect(withVolume!.volume).toBe(1200);
    expect(without).not.toHaveProperty("volume");
  });

  it("a collected snapshot states its symbol, source, retrieval time and data time", async () => {
    const snap = await collectMarketData(mock(), "EUR/USD", { maxAgeSeconds: 120, now: () => NOW });
    expect(snap).toMatchObject({ symbol: "EUR/USD", source: "mock", sourceName: expect.any(String), retrievedAt: NOW, stale: false });
    expect(snap.dataTimestamp).toBeGreaterThan(NOW - 60_000);
    expect(Object.keys(snap.candles)).toEqual(["H4", "H1", "M15", "M5"]);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap); // plain, serialisable data
  });

  it("candle responses carry symbol, timeframe, source and retrieval time", async () => {
    const m = mock();
    const service = new MarketDataService({ live: null, liveUnavailableReason: "", mock: { provider: m, stream: new MockPriceStream(m) }, mode: "MOCK", usage: new UsageTracker(), now: () => NOW });
    const { metadata } = await service.getCandlesWithInfo("eurusd", "M15", 50);
    expect(metadata).toEqual({ symbol: "EUR/USD", timeframe: "M15", retrievedAt: NOW, source: "mock" });
  });
});

describe("analysis snapshot", () => {
  it("is built from normalised candles alone, stamped with asOf and its source", () => {
    const candles = hourly(260);
    const asOf = candles.at(-1)!.timestamp + HOUR;
    const snap = buildAnalysisSnapshot(dataSnapshot(candles), asOf);
    expect(snap.symbol).toBe("EUR/USD");
    expect(snap.asOf).toBe(asOf);
    expect(snap.metadata).toMatchObject({ source: "test", retrievedAt: candles.at(-1)!.timestamp + 1000 });
    expect(snap.timeframes[0]!.indicators.ema200).not.toBeNull();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it("historical replay: rewriting everything after asOf cannot change the snapshot", () => {
    const candles = hourly(260);
    const asOf = candles[200]!.timestamp + HOUR; // candle 200 has just closed
    const replay = { includeFormingCandle: false };
    const before = buildAnalysisSnapshot(dataSnapshot(candles), asOf, replay);
    const future = candles.map((c, i) => (i > 200 ? { ...c, open: 9, high: 10, low: 8, close: 9.5 } : c));
    const after = buildAnalysisSnapshot(dataSnapshot(future), asOf, replay);
    expect(after.timeframes).toEqual(before.timeframes);
    expect(after.candles.H1).toHaveLength(201);
  });

  it("live use keeps the bar open at asOf but nothing that opens later", () => {
    const candles = hourly(260);
    const asOf = candles[200]!.timestamp + HOUR / 2; // halfway through candle 200
    const snap = buildAnalysisSnapshot(dataSnapshot(candles), asOf);
    expect(snap.candles.H1).toHaveLength(201);
    expect(snap.candles.H1!.every((c) => c.timestamp <= asOf)).toBe(true);
  });

  it("can exclude the bar still forming at asOf (for historical replay)", () => {
    const candles = hourly(10);
    const midBar = candles[5]!.timestamp + HOUR / 2;
    expect(candlesKnownAt(candles, "H1", midBar)).toHaveLength(5);
    expect(candlesKnownAt(candles, "H1", midBar, { includeForming: true })).toHaveLength(6);
    const snap = buildAnalysisSnapshot(dataSnapshot(candles), midBar, { includeFormingCandle: false });
    expect(snap.candles.H1).toHaveLength(5);
  });
});

describe("no lookahead in indicators", () => {
  it("the value at bar i depends only on bars 0..i", () => {
    const candles = hourly(300);
    const closes = candles.map((c) => c.close);
    const full = { ema: ema(closes, 50), rsi: rsi(closes, 14), atr: atr(candles, 14) };
    for (const i of [60, 150, 299]) {
      expect(ema(closes.slice(0, i + 1), 50).at(-1)).toBeCloseTo(full.ema[i]!, 12);
      expect(rsi(closes.slice(0, i + 1), 14).at(-1)).toBeCloseTo(full.rsi[i]!, 12);
      expect(atr(candles.slice(0, i + 1), 14).at(-1)).toBeCloseTo(full.atr[i]!, 12);
    }
  });
});
