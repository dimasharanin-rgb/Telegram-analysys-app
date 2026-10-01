import type { Candle } from "@/shared/types/market";
import type { IndicatorSet, TimeframeAnalysis } from "@/shared/types/technical";
import { PRIMARY_TIMEFRAMES, TIMEFRAME_SECONDS, type Timeframe } from "@/shared/types/trade";
import { calculateIndicators } from "@/technical/indicators";
import { findLevels } from "@/technical/levels";
import { analyzeMarketStructure } from "@/technical/structure";

/** Candles of history used for swings, levels and structure (indicators use the full series). */
const STRUCTURE_WINDOW = 150;

export function emaTrend(ind: IndicatorSet): TimeframeAnalysis["emaTrend"] {
  const { ema20, ema50, ema200 } = ind;
  if (ema20 === null || ema50 === null) return "UNKNOWN";
  if (ema20 > ema50 && (ema200 === null || ema50 > ema200)) return "UP";
  if (ema20 < ema50 && (ema200 === null || ema50 < ema200)) return "DOWN";
  return "MIXED";
}

export function analyzeTimeframe(timeframe: Timeframe, candles: Candle[]): TimeframeAnalysis {
  const indicators = calculateIndicators(candles);
  const window = candles.slice(-STRUCTURE_WINDOW);
  const structure = analyzeMarketStructure(window);
  const levels = findLevels(structure.swings, indicators.lastClose, indicators.atr14);
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
  };
}

/** Timeframes analysed for a trade: always M5, M15, H1 and H4, plus the trade's own if different. Highest first. */
export function analysisTimeframes(tradeTimeframe: Timeframe): Timeframe[] {
  const set = new Set<Timeframe>([...PRIMARY_TIMEFRAMES, tradeTimeframe]);
  return [...set].sort((a, b) => TIMEFRAME_SECONDS[b] - TIMEFRAME_SECONDS[a]);
}
