import { describe, expect, it } from "vitest";
import type { Candle } from "@/types/market";
import { analyzeMarketStructure, atr, calculateIndicators, ema, findLevels, findSwings, rsi } from "@/technical";

const candle = (i: number, close: number, spread = 0.5): Candle => ({ time: i * 60, open: close, high: close + spread, low: close - spread, close });

/** Zig-zag path through the given turning points, one candle per unit step. */
function path(points: number[]): Candle[] {
  const closes: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const steps = Math.abs(b - a);
    for (let s = 0; s < steps; s++) closes.push(a + Math.sign(b - a) * s);
  }
  closes.push(points[points.length - 1]!);
  return closes.map((c, i) => candle(i, c));
}

describe("indicators", () => {
  it("EMA seeds with the SMA and then smooths", () => {
    const out = ema([1, 2, 3, 4, 5, 6], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(3); // 4*0.5 + 2*0.5
    expect(out[5]).toBe(5);
  });

  it("RSI is 100 for a series that only rises and 50 when flat", () => {
    expect(rsi(Array.from({ length: 30 }, (_, i) => i), 14).at(-1)).toBe(100);
    expect(rsi(Array.from({ length: 30 }, () => 5), 14).at(-1)).toBe(50);
  });

  it("RSI follows Wilder's smoothing", () => {
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46];
    const out = rsi(closes, 14);
    // First 14 changes: gains sum 3.34, losses sum 1.40 → simple averages.
    let gain = 3.34 / 14;
    let loss = 1.4 / 14;
    expect(out[14]).toBeCloseTo(100 - 100 / (1 + gain / loss), 6);
    // Next change is -0.28: Wilder smoothing.
    gain = (gain * 13) / 14;
    loss = (loss * 13 + 0.28) / 14;
    expect(out[15]).toBeCloseTo(100 - 100 / (1 + gain / loss), 6);
  });

  it("ATR of constant-range candles equals the range", () => {
    const candles = Array.from({ length: 30 }, (_, i) => candle(i, 100, 1));
    expect(atr(candles, 14).at(-1)).toBeCloseTo(2, 10);
  });

  it("returns null indicators when history is too short (no guessing)", () => {
    const ind = calculateIndicators(Array.from({ length: 40 }, (_, i) => candle(i, 100 + i)));
    expect(ind.ema20).not.toBeNull();
    expect(ind.ema50).toBeNull();
    expect(ind.ema200).toBeNull();
    expect(ind.volatility).toBe("UNKNOWN"); // fewer than 30 ATR values to compare against
  });
});

describe("market structure", () => {
  it("labels higher highs and higher lows as BULLISH", () => {
    const s = analyzeMarketStructure(path([100, 110, 105, 115, 108, 120, 112, 117]));
    // highs 110 → 115 → 120, lows 105 → 108 → 112 (the first of each has nothing to compare with)
    expect(s.swings.map((x) => x.label).filter(Boolean)).toEqual(["HH", "HL", "HH", "HL"]);
    expect(s.bias).toBe("BULLISH");
  });

  it("labels lower highs and lower lows as BEARISH", () => {
    expect(analyzeMarketStructure(path([120, 110, 115, 105, 112, 100, 108, 103])).bias).toBe("BEARISH");
  });

  it("calls mixed swings a RANGE", () => {
    // lower high, higher low → contracting
    expect(analyzeMarketStructure(path([100, 120, 104, 116, 108, 113, 110])).bias).toBe("RANGE");
  });

  it("is UNCLEAR when a bullish sequence has been broken", () => {
    // HH at 125 and HL at 112 are confirmed, then price falls through 112 before a new low is confirmed.
    const s = analyzeMarketStructure(path([100, 110, 105, 115, 108, 120, 112, 125, 100]));
    expect(s.bias).toBe("UNCLEAR");
    expect(s.reason).toMatch(/closed below the last higher low/);
  });

  it("is UNCLEAR without enough swings", () => {
    expect(analyzeMarketStructure(path([100, 130])).bias).toBe("UNCLEAR");
  });

  it("alternates swing highs and lows", () => {
    const swings = findSwings(path([100, 110, 105, 115, 108, 120, 112, 117]));
    for (let i = 1; i < swings.length; i++) expect(swings[i]!.kind).not.toBe(swings[i - 1]!.kind);
  });

  it("clusters swing prices into support and resistance around the current price", () => {
    const s = analyzeMarketStructure(path([100, 110, 101, 110, 100, 110, 104]));
    const { support, resistance } = findLevels(s.swings, 104, 2);
    expect(resistance[0]!.price).toBeCloseTo(110.5, 1);
    expect(resistance[0]!.touches).toBeGreaterThanOrEqual(2);
    expect(support[0]!.price).toBeLessThan(104);
  });
});
