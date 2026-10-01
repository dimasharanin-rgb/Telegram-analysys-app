import type { InstrumentSpec } from "@/types/instrument";
import type { RiskCalculation } from "@/types/risk";
import type { TradeInput } from "@/types/trade";
import { floorToStep, round } from "@/lib/math";
import type { QuoteConversion } from "./conversion";

export interface RiskRewardResult {
  /** Positive when the stop is on the losing side of entry. */
  riskDistance: number;
  /** Positive when the target is on the winning side of entry. */
  rewardDistance: number;
  /** reward / risk, or NaN when risk distance is not positive. */
  riskReward: number;
}

/**
 * LONG:  risk = entry - stop,   reward = target - entry
 * SHORT: risk = stop - entry,   reward = entry - target
 *
 * Distances are rounded a little beyond the quote precision so binary floating
 * point (1.1735 - 1.1715 = 0.0020000000000000018) cannot turn 1:2 into 1:1.999.
 */
export function calculateRR(
  trade: Pick<TradeInput, "direction" | "entry" | "stopLoss" | "takeProfit">,
  instrument: Pick<InstrumentSpec, "pricePrecision">,
): RiskRewardResult {
  const decimals = instrument.pricePrecision + 3;
  const long = trade.direction === "LONG";
  const riskDistance = round(long ? trade.entry - trade.stopLoss : trade.stopLoss - trade.entry, decimals);
  const rewardDistance = round(long ? trade.takeProfit - trade.entry : trade.entry - trade.takeProfit, decimals);
  const riskReward = riskDistance > 0 ? round(rewardDistance / riskDistance, 6) : Number.NaN;
  return { riskDistance, rewardDistance, riskReward };
}

export interface CalculateRiskInput {
  trade: TradeInput;
  instrument: InstrumentSpec;
  accountCurrency: string;
  /** Balance that risk percentages are measured against. */
  equity: number;
  maxRiskPercent: number;
  conversion: QuoteConversion;
}

/** Money lost per lot if the stop is hit, in account currency. */
export function riskPerLot(input: Omit<CalculateRiskInput, "equity" | "maxRiskPercent" | "accountCurrency">): number {
  const { riskDistance } = calculateRR(input.trade, input.instrument);
  return riskDistance * input.instrument.contractSize * input.conversion.rateAt(input.trade.stopLoss);
}

/**
 * Largest position (lots) whose loss at the stop stays within the risk budget,
 * rounded DOWN to the lot step so the suggestion never exceeds the limit.
 * Returns 0 when even the minimum lot would exceed it.
 */
export function suggestPositionSize(budget: number, lossPerLot: number, instrument: InstrumentSpec): number {
  if (!(lossPerLot > 0) || !(budget > 0)) return 0;
  const lots = floorToStep(budget / lossPerLot, instrument.lotStep);
  return lots >= instrument.minLot ? lots : 0;
}

/**
 * Money figures for a structurally valid trade (stop and target on the correct
 * sides). Uses the user's position size when given, otherwise the suggested
 * size; if no size fits the budget, the minimum lot is used so the caller can
 * show what the smallest possible trade would risk.
 */
export function calculateRisk(input: CalculateRiskInput): RiskCalculation {
  const { trade, instrument, conversion, equity } = input;
  const { riskDistance, rewardDistance, riskReward } = calculateRR(trade, instrument);

  const lossPerLot = riskDistance * instrument.contractSize * conversion.rateAt(trade.stopLoss);
  const gainPerLot = rewardDistance * instrument.contractSize * conversion.rateAt(trade.takeProfit);

  const budget = (equity * input.maxRiskPercent) / 100;
  const suggested = suggestPositionSize(budget, lossPerLot, instrument);

  const userSize = trade.positionSize ?? null;
  const positionSize = userSize !== null && userSize > 0 ? userSize : suggested > 0 ? suggested : instrument.minLot;
  const positionSizeSource = userSize !== null && userSize > 0 ? "USER" : "SUGGESTED";

  const riskAmount = lossPerLot * positionSize;
  const rewardAmount = gainPerLot * positionSize;

  return {
    direction: trade.direction,
    riskDistance,
    rewardDistance,
    riskPips: round(riskDistance / instrument.pipSize, 1),
    rewardPips: round(rewardDistance / instrument.pipSize, 1),
    riskReward: round(riskReward, 4),
    positionSize,
    positionSizeSource,
    suggestedPositionSize: suggested,
    units: round(positionSize * instrument.contractSize, 4),
    riskAmount: round(riskAmount, 2),
    rewardAmount: round(rewardAmount, 2),
    riskPercent: equity > 0 ? round((riskAmount / equity) * 100, 4) : Number.POSITIVE_INFINITY,
    pipValuePerLot: round(instrument.pipSize * instrument.contractSize * conversion.rateAt(trade.entry), 4),
    accountCurrency: input.accountCurrency,
    conversion: conversion.description,
  };
}
