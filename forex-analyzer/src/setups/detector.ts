import type { AnalysisSnapshot } from "@/shared/types/analysis";
import type { SetupCandidate, SetupCondition, SetupDetectionConfig, SetupType } from "@/shared/types/setup";
import type { TimeframeAnalysis } from "@/shared/types/technical";
import { TIMEFRAME_SECONDS, type Direction, type Timeframe } from "@/shared/types/trade";
import { DEFAULT_SETUP_CONFIG } from "./config";

/**
 * Deterministic setup detection: "is there a technically interesting situation
 * right now?" — never "should this be traded?".
 *
 * Works only from an AnalysisSnapshot (facts already computed at its `asOf`),
 * so it cannot fetch data, look ahead, or call an AI. Each candidate carries
 * the full list of conditions it checked. Returning no candidates is normal.
 */
export function detectSetups(snapshot: AnalysisSnapshot, config: SetupDetectionConfig = DEFAULT_SETUP_CONFIG): SetupCandidate[] {
  if (!config.enabled) return [];
  if (config.allowedSymbols.length > 0 && !config.allowedSymbols.includes(snapshot.symbol)) return [];

  const out: SetupCandidate[] = [];
  for (const entry of snapshot.timeframes) {
    if (!config.allowedTimeframes.includes(entry.timeframe)) continue;
    if (entry.indicators.atr14 === null || entry.candleCount === 0) continue;
    const context = snapshot.timeframes.filter((t) => TIMEFRAME_SECONDS[t.timeframe] > TIMEFRAME_SECONDS[entry.timeframe]);
    for (const direction of ["LONG", "SHORT"] as const) {
      for (const type of config.allowedSetupTypes) {
        const candidate = evaluate(type, direction, entry, context, snapshot, config);
        if (candidate) out.push(candidate);
      }
    }
  }
  return out;
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5));
const atr = (v: number | null) => (v === null ? "n/a" : `${v.toFixed(2)} ATR`);

/** Higher-timeframe agreement: every context timeframe has structure or EMAs in the direction, none has opposing structure. */
function contextAgrees(context: TimeframeAnalysis[], bias: "BULLISH" | "BEARISH"): { agrees: boolean | null; opposed: boolean; detail: string } {
  if (context.length === 0) return { agrees: null, opposed: false, detail: "No higher timeframe in the snapshot." };
  const opposite = bias === "BULLISH" ? "BEARISH" : "BULLISH";
  const opposed = context.some((t) => t.structure.bias === opposite);
  const agrees = !opposed && context.every((t) => t.structure.bias === bias || t.trend.direction === bias);
  return { agrees, opposed, detail: context.map((t) => `${t.timeframe} structure ${t.structure.bias}, EMAs ${t.trend.direction}`).join("; ") };
}

/** Distance (ATRs) to the nearest level price would pull back to: support/EMA below for LONG, resistance/EMA above for SHORT. */
function nearestProtectiveLevel(entry: TimeframeAnalysis, direction: Direction): { distance: number | null; label: string } {
  const long = direction === "LONG";
  const options: { d: number; label: string }[] = [];
  const level = long ? entry.support[0] : entry.resistance[0];
  if (level?.distanceAtr != null) options.push({ d: level.distanceAtr, label: `${long ? "support" : "resistance"} ${fmt(level.price)}` });
  for (const [name, d] of [["EMA20", entry.trend.distanceFromEma20Atr], ["EMA50", entry.trend.distanceFromEma50Atr]] as const) {
    // Only an EMA on the correct side of price counts (below for LONG, above for SHORT).
    if (d !== null && (long ? d >= 0 : d <= 0)) options.push({ d: Math.abs(d), label: name });
  }
  if (options.length === 0) return { distance: null, label: "no level on that side" };
  const best = options.reduce((a, b) => (b.d < a.d ? b : a));
  return { distance: best.d, label: best.label };
}

function evaluate(
  type: SetupType,
  direction: Direction,
  entry: TimeframeAnalysis,
  context: TimeframeAnalysis[],
  snapshot: AnalysisSnapshot,
  config: SetupDetectionConfig,
): SetupCandidate | null {
  const long = direction === "LONG";
  const bias = long ? "BULLISH" : "BEARISH";
  const tf = entry.timeframe;
  const conditions: SetupCondition[] = [];
  const add = (name: string, met: boolean, required: boolean, detail: string) => conditions.push({ name, met, required, detail });

  const htf = contextAgrees(context, bias);
  const atrPct = entry.volatility.atrPercent;
  const atrOk = config.minimumAtrPercent === null || (atrPct !== null && atrPct >= config.minimumAtrPercent);
  const swingLow = entry.recentSwingLows.at(-1) ?? null;
  const swingHigh = entry.recentSwingHighs.at(-1) ?? null;
  let triggerPrice: number | undefined;

  if (type === "CONTINUATION" || type === "PULLBACK") {
    if (htf.agrees !== null) add("Higher-timeframe agreement", htf.agrees, config.requireHigherTimeframeAgreement, htf.detail);
    const level = nearestProtectiveLevel(entry, direction);
    add(
      "Near a reference level",
      level.distance !== null && level.distance <= config.maxDistanceFromLevelAtr,
      true,
      `Nearest ${level.label} is ${atr(level.distance)} away (limit ${config.maxDistanceFromLevelAtr} ATR).`,
    );
    if (type === "CONTINUATION") {
      add(`${tf} structure ${bias}`, entry.structure.bias === bias, true, `${tf} structure ${entry.structure.bias} (${entry.structure.sequence.join(" / ") || "no swings"}).`);
      add(`${tf} EMAs aligned ${bias}`, entry.trend.direction === bias, config.requireTrendAlignment, `EMA20/50/200: ${entry.trend.direction}.`);
      const exhausted = long ? entry.momentum.state === "OVERBOUGHT" : entry.momentum.state === "OVERSOLD";
      add("Momentum not stretched", !exhausted, false, `RSI ${entry.momentum.rsi14?.toFixed(1) ?? "n/a"} (${entry.momentum.state}).`);
    } else {
      add(`${tf} longer EMAs ${bias}`, entry.trend.ema50Above200 === (long ? true : false), true, `EMA50 ${entry.trend.ema50Above200 ? "above" : "below"} EMA200.`);
      const counter = long ? entry.trend.priceAbove20 === false || entry.structure.bias !== "BULLISH" : entry.trend.priceAbove20 === true || entry.structure.bias !== "BEARISH";
      add("Temporary move against the trend", counter, true, `Price ${entry.trend.priceAbove20 ? "above" : "below"} EMA20; ${tf} structure ${entry.structure.bias}.`);
      const change = entry.momentum.rsiChange;
      add("Momentum turning back with the trend", change !== null && (long ? change > 0 : change < 0), true, `RSI change ${change === null ? "n/a" : change.toFixed(1)} over the last bars.`);
    }
  } else if (type === "BREAKOUT") {
    const range = entry.volatility.recentRangeAtr;
    add("Compression", range !== null && range <= config.compressionMaxRangeAtr, true, `Recent range ${atr(range)} (limit ${config.compressionMaxRangeAtr} ATR).`);
    const level = long ? (entry.resistance[0] ?? null) : (entry.support[0] ?? null);
    const swing = long ? swingHigh : swingLow;
    const candles = snapshot.candles[tf] ?? [];
    const close = candles.at(-1)?.close ?? null;
    const prev = candles.at(-2)?.close ?? null;
    const broke = swing !== null && close !== null && prev !== null && (long ? close > swing && prev <= swing : close < swing && prev >= swing);
    const approaching = level?.distanceAtr != null && level.distanceAtr <= config.maxDistanceFromLevelAtr;
    triggerPrice = broke ? swing! : level?.price;
    add(
      long ? "At or through resistance" : "At or through support",
      broke || approaching,
      true,
      broke ? `Latest close broke the swing ${long ? "high" : "low"} ${fmt(swing!)}.` : level ? `${long ? "Resistance" : "Support"} ${fmt(level.price)} is ${atr(level.distanceAtr)} away.` : "No level on that side.",
    );
    if (context.length) add("Higher timeframe not opposed", !htf.opposed, true, htf.detail);
  } else {
    return null; // REVERSAL / OTHER: reserved, not detected yet
  }
  add("Enough volatility", atrOk, true, `ATR ${atrPct === null ? "n/a" : `${atrPct.toFixed(3)}%`} of price${config.minimumAtrPercent === null ? "" : ` (minimum ${config.minimumAtrPercent}%)`}.`);

  if (conditions.some((c) => c.required && !c.met)) return null;
  const completeness = conditions.filter((c) => c.met).length / conditions.length;
  if (completeness < config.minimumCompleteness) return null;

  const ctxNames = context.map((t) => t.timeframe as Timeframe);
  const invalidation = [
    ...(long && swingLow !== null ? [`${tf} closes below the recent swing low ${fmt(swingLow)}.`] : []),
    ...(!long && swingHigh !== null ? [`${tf} closes above the recent swing high ${fmt(swingHigh)}.`] : []),
    ...(type === "BREAKOUT" && triggerPrice !== undefined ? [`Price closes back ${long ? "below" : "above"} ${fmt(triggerPrice)}.`] : []),
    ...(ctxNames.length ? [`${ctxNames.join("/")} structure turns ${long ? "BEARISH" : "BULLISH"}.`] : []),
  ];

  return {
    id: `${snapshot.symbol}:${tf}:${type}:${direction}:${snapshot.asOf}`,
    symbol: snapshot.symbol,
    asOf: snapshot.asOf,
    direction,
    setupType: type,
    timeframe: tf,
    contextTimeframes: ctxNames,
    ...(triggerPrice !== undefined ? { triggerPrice } : {}),
    referenceLevels: {
      nearestSupport: entry.support[0]?.price ?? null,
      nearestResistance: entry.resistance[0]?.price ?? null,
      recentSwingLow: swingLow,
      recentSwingHigh: swingHigh,
      atr14: entry.indicators.atr14,
    },
    reasons: conditions.filter((c) => c.met).map((c) => `${c.name}: ${c.detail}`),
    invalidationConditions: invalidation,
    conditions,
    completeness: Math.round(completeness * 100) / 100,
    marketContext: [entry, ...context],
  };
}
