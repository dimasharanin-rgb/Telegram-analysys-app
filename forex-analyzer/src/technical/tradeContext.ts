import type { TradeContext } from "@/shared/types/analysis";
import type { Quote } from "@/shared/types/market";
import type { TimeframeAnalysis } from "@/shared/types/technical";
import type { TradeInput } from "@/shared/types/trade";

const AT_MARKET_ATR = 0.25;
const MAX_LEVELS_BETWEEN = 6;

/**
 * Relates the proposed trade to the analysed market: how far entry, stop and
 * target are in ATRs, which levels stand between entry and target, and whether
 * the stop sits beyond recent structure. Pure and deterministic.
 */
export function buildTradeContext(
  trade: TradeInput,
  price: Quote,
  timeframes: TimeframeAnalysis[],
): TradeContext {
  const long = trade.direction === "LONG";
  const own = timeframes.find((t) => t.timeframe === trade.timeframe);
  const atr = own?.indicators.atr14 ?? null;
  const inAtr = (d: number) => (atr !== null && atr > 0 ? Math.abs(d) / atr : null);

  const entryOffset = trade.entry - price.mid;
  const entryDistanceAtr = inAtr(entryOffset);
  const entryRelation =
    entryDistanceAtr !== null && entryDistanceAtr < AT_MARKET_ATR
      ? "AT_MARKET"
      : entryOffset > 0
        ? "ABOVE_MARKET"
        : "BELOW_MARKET";

  const lo = Math.min(trade.entry, trade.takeProfit);
  const hi = Math.max(trade.entry, trade.takeProfit);
  // Lower timeframes than the trade's are too granular to count as obstacles.
  const ownIndex = timeframes.findIndex((t) => t.timeframe === trade.timeframe);
  const relevant = ownIndex === -1 ? timeframes : timeframes.slice(0, ownIndex + 1);
  const levelsBetweenEntryAndTarget = relevant
    .flatMap((t) =>
      [...t.support, ...t.resistance].map((l) => ({ timeframe: t.timeframe, price: l.price, touches: l.touches })),
    )
    .filter((l) => l.price > lo && l.price < hi)
    .sort((a, b) => (long ? a.price - b.price : b.price - a.price))
    .slice(0, MAX_LEVELS_BETWEEN);

  const swings = long ? own?.recentSwingLows : own?.recentSwingHighs;
  const referenceSwing = swings && swings.length ? swings[swings.length - 1]! : null;
  const stopBeyondRecentSwing =
    referenceSwing === null ? null : long ? trade.stopLoss < referenceSwing : trade.stopLoss > referenceSwing;

  const riskDistance = Math.abs(trade.entry - trade.stopLoss);
  return {
    tradeTimeframe: trade.timeframe,
    atr,
    entryRelation,
    entryDistanceAtr,
    stopDistanceAtr: inAtr(riskDistance),
    targetDistanceAtr: inAtr(trade.takeProfit - trade.entry),
    levelsBetweenEntryAndTarget,
    referenceSwing,
    stopBeyondRecentSwing,
    spreadToStopRatio: price.spread !== null && riskDistance > 0 ? price.spread / riskDistance : null,
  };
}
