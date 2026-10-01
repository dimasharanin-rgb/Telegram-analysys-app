import type { InstrumentSpec } from "@/shared/types/instrument";
import type { RiskCheck } from "@/shared/types/risk";
import { DIRECTIONS, type TradeInput } from "@/shared/types/trade";
import { formatPrice } from "@/shared/instruments";
import { calculateRR } from "@/risk/calculations";

function isPositiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Structural checks that make a trade meaningful at all: a known instrument, a
 * valid direction, positive prices, and stop/target on the correct sides of
 * entry. Every failure here is a BLOCK.
 */
export function validateTrade(trade: TradeInput, instrument: InstrumentSpec | undefined): RiskCheck[] {
  const checks: RiskCheck[] = [];

  checks.push(
    instrument
      ? { id: "PAIR_KNOWN", label: "Instrument recognised", status: "PASS", detail: `${instrument.displayName} (${instrument.assetClass})` }
      : { id: "PAIR_KNOWN", label: "Instrument recognised", status: "BLOCK", detail: `"${trade.pair}" is not a supported instrument.` },
  );

  const directionOk = (DIRECTIONS as readonly string[]).includes(trade.direction);
  checks.push({
    id: "DIRECTION_VALID",
    label: "Direction valid",
    status: directionOk ? "PASS" : "BLOCK",
    detail: directionOk ? trade.direction : `Direction must be LONG or SHORT, got "${String(trade.direction)}".`,
  });

  const pricesOk =
    isPositiveNumber(trade.entry) && isPositiveNumber(trade.stopLoss) && isPositiveNumber(trade.takeProfit);
  checks.push({
    id: "PRICES_VALID",
    label: "Prices valid",
    status: pricesOk ? "PASS" : "BLOCK",
    detail: pricesOk ? "Entry, stop loss and take profit are positive numbers." : "Entry, stop loss and take profit must all be positive numbers.",
  });

  if (!instrument || !directionOk || !pricesOk) return checks;

  const { riskDistance, rewardDistance } = calculateRR(trade, instrument);
  const fmt = (p: number) => formatPrice(p, instrument);
  const long = trade.direction === "LONG";
  const pips = (d: number) => (Math.abs(d) / instrument.pipSize).toFixed(1);

  if (riskDistance > 0) {
    checks.push({
      id: "STOP_LOSS_SIDE",
      label: "Stop loss on correct side",
      status: "PASS",
      detail: `SL ${fmt(trade.stopLoss)} is ${long ? "below" : "above"} entry ${fmt(trade.entry)} (${pips(riskDistance)} pips).`,
    });
  } else {
    checks.push({
      id: "STOP_LOSS_SIDE",
      label: "Stop loss on correct side",
      status: "BLOCK",
      detail:
        riskDistance === 0
          ? "Stop loss equals entry; risk cannot be measured."
          : `For a ${trade.direction} the stop loss must be ${long ? "below" : "above"} entry (SL ${fmt(trade.stopLoss)}, entry ${fmt(trade.entry)}).`,
    });
  }

  if (rewardDistance > 0) {
    checks.push({
      id: "TAKE_PROFIT_SIDE",
      label: "Take profit on correct side",
      status: "PASS",
      detail: `TP ${fmt(trade.takeProfit)} is ${long ? "above" : "below"} entry (${pips(rewardDistance)} pips).`,
    });
  } else {
    checks.push({
      id: "TAKE_PROFIT_SIDE",
      label: "Take profit on correct side",
      status: "BLOCK",
      detail:
        rewardDistance === 0
          ? "Take profit equals entry; there is no reward."
          : `For a ${trade.direction} the take profit must be ${long ? "above" : "below"} entry (TP ${fmt(trade.takeProfit)}, entry ${fmt(trade.entry)}).`,
    });
  }

  return checks;
}
