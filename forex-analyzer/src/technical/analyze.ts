import type { Candle } from "@/shared/types/market";
import type { IndicatorSet, TimeframeAnalysis } from "@/shared/types/technical";
import { PRIMARY_TIMEFRAMES, TIMEFRAME_SECONDS, type Timeframe } from "@/shared/types/trade";
import { calculateIndicators } from "@/technical/indicators";
import { findLevels } from "@/technical/levels";
import { analyzeMarketStructure } from "@/technical/structure";

import { DEFAULT_TECHNICAL_CONFIG, type TechnicalConfig } from "./config";
import { momentumState, trendState, volatilityState } from "./state";

export function emaTrend(ind: IndicatorSet): TimeframeAnalysis["emaTrend"] {
  const { ema20, ema50, ema200 } = ind;
  if (ema20 === null || ema50 === null) return "UNKNOWN";
  if (ema20 > ema50 && (ema200 === null || ema50 > ema200)) return "UP";
  if (ema20 < ema50 && (ema200 === null || ema50 < ema200)) return "DOWN";
  return "MIXED";
}

/**
 * Every deterministic fact about one timeframe, from one candle series (oldest
 * first, ending at the moment being described). Indicators, structure, levels
 * and the trend/momentum/volatility states are all computed from these candles;
 * nothing is fetched and nothing looks past the last candle.
 */
export function analyzeTimeframe(timeframe: Timeframe, candles: Candle[], config: TechnicalConfig = DEFAULT_TECHNICAL_CONFIG): TimeframeAnalysis {
  const indicators = calculateIndicators(candles, config);
  const window = candles.slice(-config.structureWindow);
  const structure = analyzeMarketStructure(window, config.swingLookback, (indicators.atr14 ?? 0) * config.equalSwingAtr);
  const levels = findLevels(structure.swings, indicators.lastClose, indicators.atr14, config.levels);
  const recent = (kind: "HIGH" | "LOW") =>
    structure.swings
      .filter((s) => s.kind === kind)
      .slice(-3)
      .map((s) => s.price);

  return {
    timeframe,
    candleCount: candles.length,
    lastCandleTime: candles.at(-1)?.timestamp ?? 0,
    indicators,
    structure,
    recentSwingHighs: recent("HIGH"),
    recentSwingLows: recent("LOW"),
    support: levels.support,
    resistance: levels.resistance,
    emaTrend: emaTrend(indicators),
    trend: trendState(indicators),
    momentum: momentumState(candles, indicators, config),
    volatility: volatilityState(candles, indicators, config),
  };
}

/** Timeframes analysed for a trade: always M5, M15, H1 and H4, plus the trade's own if different. Highest first. */
export function analysisTimeframes(tradeTimeframe: Timeframe): Timeframe[] {
  const set = new Set<Timeframe>([...PRIMARY_TIMEFRAMES, tradeTimeframe]);
  return [...set].sort((a, b) => TIMEFRAME_SECONDS[b] - TIMEFRAME_SECONDS[a]);
}
