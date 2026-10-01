import type { MarketCheck, TradeContext } from "@/shared/types/analysis";
import type { InstrumentSpec } from "@/shared/types/instrument";
import type { Quote } from "@/shared/types/market";

export const SPREAD_SHARE_WARNING = 0.1;
export const MIN_STOP_ATR = 0.5;
export const MAX_ENTRY_DISTANCE_ATR = 3;

/** Deterministic checks against live market data. They can warn and cap the verdict, but never block. */
export function runMarketChecks(price: Quote, context: TradeContext, instrument: InstrumentSpec): MarketCheck[] {
  const checks: MarketCheck[] = [];
  const tf = context.tradeTimeframe;

  if (price.spread === null || context.spreadToStopRatio === null) {
    checks.push({ id: "SPREAD", label: "Spread", status: "WARNING", capsVerdict: false, detail: "The data provider does not report a spread, so its cost could not be assessed." });
  } else {
    const pips = (price.spread / instrument.pipSize).toFixed(1);
    const share = (context.spreadToStopRatio * 100).toFixed(0);
    checks.push(
      context.spreadToStopRatio > SPREAD_SHARE_WARNING
        ? { id: "SPREAD", label: "Spread", status: "WARNING", capsVerdict: true, detail: `Spread ${pips} pips is ${share}% of the stop distance.` }
        : { id: "SPREAD", label: "Spread", status: "PASS", capsVerdict: false, detail: `Spread ${pips} pips (${share}% of the stop distance).` },
    );
  }

  if (context.stopDistanceAtr !== null) {
    const x = context.stopDistanceAtr.toFixed(2);
    checks.push(
      context.stopDistanceAtr < MIN_STOP_ATR
        ? { id: "STOP_VS_ATR", label: "Stop vs volatility", status: "WARNING", capsVerdict: true, detail: `Stop is ${x} × ATR(${tf}), inside normal ${tf} noise.` }
        : { id: "STOP_VS_ATR", label: "Stop vs volatility", status: "PASS", capsVerdict: false, detail: `Stop is ${x} × ATR(${tf}).` },
    );
  }

  if (context.entryDistanceAtr !== null) {
    const x = context.entryDistanceAtr.toFixed(2);
    const where = context.entryRelation === "AT_MARKET" ? "at market" : context.entryRelation === "ABOVE_MARKET" ? "above market" : "below market";
    checks.push(
      context.entryDistanceAtr > MAX_ENTRY_DISTANCE_ATR
        ? { id: "ENTRY_DISTANCE", label: "Entry vs current price", status: "WARNING", capsVerdict: true, detail: `Entry is ${x} × ATR(${tf}) ${where}; conditions may differ by the time price gets there.` }
        : { id: "ENTRY_DISTANCE", label: "Entry vs current price", status: "PASS", capsVerdict: false, detail: `Entry is ${x} × ATR(${tf}) ${where}.` },
    );
  }

  return checks;
}
