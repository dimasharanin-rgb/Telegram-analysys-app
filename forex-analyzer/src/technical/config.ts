/**
 * Every threshold the technical engine uses, in one place. Changing a value
 * here changes classification everywhere; nothing else hard-codes them.
 * These describe market state only. None of them is a trading rule.
 */
export interface TechnicalConfig {
  /** RSI 14 bands: below `oversold` OVERSOLD, below `weakBearish` WEAK_BEARISH, below `neutralHigh` NEUTRAL, up to `overbought` BULLISH, above OVERBOUGHT. */
  rsi: { oversold: number; weakBearish: number; neutralHigh: number; overbought: number };
  /** Bars back for the RSI change ("is momentum recovering?"). */
  momentumLookbackBars: number;
  /** Current ATR / median ATR over `lookbackBars`: below `low` LOW, above `high` HIGH. */
  volatility: { lookbackBars: number; low: number; high: number; minimumHistory: number };
  /** Bars whose high-low range is compared with ATR to spot compression. */
  compressionBars: number;
  /** Bars on each side of a fractal swing point. */
  swingLookback: number;
  /** Swings within this many ATRs of the previous one count as equal (not higher, not lower). */
  equalSwingAtr: number;
  /** Candles used for swings, structure and levels (indicators use the full series). */
  structureWindow: number;
  /** Swing prices closer than this many ATRs form one level; levels returned per side. */
  levels: { clusterAtr: number; maxPerSide: number };
}

export const DEFAULT_TECHNICAL_CONFIG: TechnicalConfig = {
  rsi: { oversold: 30, weakBearish: 45, neutralHigh: 55, overbought: 70 },
  momentumLookbackBars: 3,
  volatility: { lookbackBars: 100, low: 0.75, high: 1.35, minimumHistory: 30 },
  compressionBars: 12,
  swingLookback: 3,
  equalSwingAtr: 0.1,
  structureWindow: 150,
  levels: { clusterAtr: 0.35, maxPerSide: 3 },
};
