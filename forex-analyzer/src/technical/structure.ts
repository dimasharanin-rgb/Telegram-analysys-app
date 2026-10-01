import type { Candle } from "@/shared/types/market";
import type { MarketStructure, SwingLabel, SwingPoint } from "@/shared/types/technical";

/** Bars required on each side of a pivot for it to count as a swing. */
export const SWING_LOOKBACK = 3;

/**
 * Fractal swing points: a bar whose high is above the `lookback` bars before it
 * and not below the `lookback` bars after it (mirror for lows). The last
 * `lookback` bars cannot be confirmed yet and are ignored. Consecutive swings
 * of the same kind are merged, keeping the more extreme, so highs and lows
 * alternate.
 */
export function findSwings(candles: Candle[], lookback = SWING_LOOKBACK): SwingPoint[] {
  const raw: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      const before = candles[i - j]!;
      const after = candles[i + j]!;
      if (!(c.high > before.high && c.high >= after.high)) isHigh = false;
      if (!(c.low < before.low && c.low <= after.low)) isLow = false;
    }
    if (isHigh) raw.push({ kind: "HIGH", timestamp: c.timestamp, price: c.high, index: i, label: null });
    if (isLow) raw.push({ kind: "LOW", timestamp: c.timestamp, price: c.low, index: i, label: null });
  }

  const alternating: SwingPoint[] = [];
  for (const s of raw) {
    const prev = alternating.at(-1);
    if (prev && prev.kind === s.kind) {
      const moreExtreme = s.kind === "HIGH" ? s.price > prev.price : s.price < prev.price;
      if (moreExtreme) alternating[alternating.length - 1] = s;
    } else {
      alternating.push(s);
    }
  }

  let lastHigh: SwingPoint | undefined;
  let lastLow: SwingPoint | undefined;
  return alternating.map((s) => {
    if (s.kind === "HIGH") {
      const label = lastHigh ? (s.price > lastHigh.price ? "HH" : "LH") : null;
      lastHigh = s;
      return { ...s, label };
    }
    const label = lastLow ? (s.price > lastLow.price ? "HL" : "LL") : null;
    lastLow = s;
    return { ...s, label };
  });
}

/**
 * Directional structure from the most recent swing high and swing low:
 *
 * - HH + HL → BULLISH, unless the close has already broken below that HL → UNCLEAR
 * - LH + LL → BEARISH, unless the close has already broken above that LH → UNCLEAR
 * - HH + LL or LH + HL → RANGE (expanding or contracting)
 * - a swing within `equalTolerance` of the previous one → RANGE (balanced)
 * - fewer than two of either → UNCLEAR
 */
export function analyzeMarketStructure(candles: Candle[], lookback = SWING_LOOKBACK, equalTolerance = 0): MarketStructure {
  const swings = findSwings(candles, lookback);
  const highs = swings.filter((s) => s.kind === "HIGH");
  const lows = swings.filter((s) => s.kind === "LOW");
  const lastHigh = highs.at(-1);
  const lastLow = lows.at(-1);
  const close = candles.at(-1)?.close;

  if (!lastHigh?.label || !lastLow?.label || close === undefined) {
    return { bias: "UNCLEAR", swings, sequence: labels(swings), reason: "Not enough confirmed swing highs and lows." };
  }

  // Swings within the tolerance of the previous one are "equal": they confirm neither direction.
  const prevHigh = highs.at(-2)!;
  const prevLow = lows.at(-2)!;
  const hDiff = lastHigh.price - prevHigh.price;
  const lDiff = lastLow.price - prevLow.price;
  const highDir = Math.abs(hDiff) <= equalTolerance ? "EQ" : hDiff > 0 ? "HH" : "LH";
  const lowDir = Math.abs(lDiff) <= equalTolerance ? "EQ" : lDiff > 0 ? "HL" : "LL";
  const hl = `${highDir}+${lowDir}`;
  if (hl === "HH+HL") {
    return close < lastLow.price
      ? { bias: "UNCLEAR", swings, sequence: labels(swings), reason: "HH/HL sequence, but price has closed below the last higher low." }
      : { bias: "BULLISH", swings, sequence: labels(swings), reason: "Higher high and higher low." };
  }
  if (hl === "LH+LL") {
    return close > lastHigh.price
      ? { bias: "UNCLEAR", swings, sequence: labels(swings), reason: "LH/LL sequence, but price has closed above the last lower high." }
      : { bias: "BEARISH", swings, sequence: labels(swings), reason: "Lower high and lower low." };
  }
  return {
    bias: "RANGE",
    swings,
    sequence: labels(swings),
    reason:
      hl === "HH+LL"
        ? "Higher high with lower low (expanding range)."
        : hl === "LH+HL"
          ? "Lower high with higher low (contracting range)."
          : "Swing highs or lows roughly equal (balanced range).",
  };
}

/** Labels of the last four labelled swings, oldest first. */
function labels(swings: SwingPoint[]): SwingLabel[] {
  return swings.flatMap((s) => (s.label ? [s.label] : [])).slice(-4);
}
