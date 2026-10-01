import type { AnalysisSnapshot } from "@/shared/types/analysis";
import type { Candle, MarketDataSnapshot } from "@/shared/types/market";
import { TIMEFRAME_SECONDS, type Timeframe } from "@/shared/types/trade";
import { candlesKnownAt } from "@/shared/candleTime";
import { analyzeTimeframe } from "./analyze";

export interface BuildSnapshotOptions {
  /**
   * Keep the bar that is still open at `asOf`. True for live analysis (its
   * values are current prices); a historical replay must pass false, because a
   * stored bar's OHLC includes prices from after `asOf`.
   */
  includeFormingCandle?: boolean;
}

/**
 * Turns normalised market data into the analysed market state at `asOf`.
 *
 * Pure and provider-agnostic: it never fetches, never calls the AI, and only
 * uses candles that were knowable at `asOf` (later candles are dropped before
 * any indicator is computed, and every indicator only looks backwards).
 */
export function buildAnalysisSnapshot(data: MarketDataSnapshot, asOf: number, opts: BuildSnapshotOptions = {}): AnalysisSnapshot {
  const includeForming = opts.includeFormingCandle ?? true;
  const candles: Partial<Record<Timeframe, Candle[]>> = {};
  const timeframes = (Object.keys(data.candles) as Timeframe[]).sort((a, b) => TIMEFRAME_SECONDS[b] - TIMEFRAME_SECONDS[a]);
  for (const tf of timeframes) candles[tf] = candlesKnownAt(data.candles[tf] ?? [], tf, asOf, { includeForming });

  return {
    symbol: data.symbol,
    asOf,
    metadata: {
      source: data.source,
      sourceName: data.sourceName,
      mode: data.mode,
      retrievedAt: data.retrievedAt,
      dataTimestamp: data.dataTimestamp,
    },
    provider: data.source,
    providerName: data.sourceName,
    isMock: data.mode === "MOCK",
    fetchedAt: data.retrievedAt,
    price: data.quote,
    timeframes: timeframes.map((tf) => analyzeTimeframe(tf, candles[tf]!)),
    candles,
  };
}
