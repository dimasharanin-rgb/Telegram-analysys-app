import type { MarketCheck, MarketSnapshot, TradeContext } from "@/shared/types/analysis";
import type { InstrumentSpec } from "@/shared/types/instrument";
import type { RiskCalculation, RiskReport } from "@/shared/types/risk";
import type { StructureBias, TimeframeAnalysis } from "@/shared/types/technical";
import type { Direction, Timeframe, TradeInput } from "@/shared/types/trade";
import { round } from "@/shared/math";

export interface PayloadLevel {
  price: number;
  touches: number;
  distanceAtr: number | null;
}

export interface PayloadTimeframe {
  timeframe: Timeframe;
  candles: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  emaTrend: TimeframeAnalysis["emaTrend"];
  rsi14: number | null;
  atr14: number | null;
  atrPercent: number | null;
  volatility: string;
  structure: StructureBias;
  structureReason: string;
  recentSwingHighs: number[];
  recentSwingLows: number[];
  support: PayloadLevel[];
  resistance: PayloadLevel[];
}

/** Everything Claude sees. Structured data only; no application text beyond the trader's own thesis. */
export interface ClaudePayload {
  pair: string;
  instrument: { assetClass: string; pipSize: number; pricePrecision: number };
  direction: Direction;
  timeframe: Timeframe;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  risk: {
    riskPercent: number;
    riskAmount: number;
    rewardAmount: number;
    riskReward: number;
    riskPips: number;
    rewardPips: number;
    positionSizeLots: number;
    accountCurrency: string;
    riskEngineStatus: RiskReport["status"];
    riskEngineWarnings: string[];
  };
  market: {
    price: number;
    bid: number | null;
    ask: number | null;
    spread: number | null;
    spreadPips: number | null;
    dataSource: string;
    syntheticData: boolean;
  };
  structure: Partial<Record<Lowercase<Timeframe>, StructureBias>>;
  timeframes: PayloadTimeframe[];
  derived: {
    atrTradeTimeframe: number | null;
    entryRelation: TradeContext["entryRelation"];
    entryDistanceAtr: number | null;
    stopDistanceAtr: number | null;
    targetDistanceAtr: number | null;
    levelsBetweenEntryAndTarget: { timeframe: Timeframe; price: number; touches: number }[];
    referenceSwing: number | null;
    stopBeyondRecentSwing: boolean | null;
  };
  marketChecks: { check: string; status: string; detail: string }[];
  missingData: string[];
  userThesis: string;
}

export interface BuildPayloadInput {
  trade: TradeInput;
  instrument: InstrumentSpec;
  risk: RiskReport;
  calculation: RiskCalculation;
  market: MarketSnapshot;
  context: TradeContext;
  marketChecks: MarketCheck[];
}

export function buildClaudePayload(input: BuildPayloadInput): ClaudePayload {
  const { trade, instrument, risk, calculation, market, context, marketChecks } = input;
  const p = instrument.pricePrecision + 1;
  const px = (v: number | null) => (v === null ? null : round(v, p));
  const r2 = (v: number | null) => (v === null ? null : round(v, 2));
  const missing: string[] = [];

  const timeframes: PayloadTimeframe[] = market.timeframes.map((t) => {
    const ind = t.indicators;
    for (const [name, value] of [["EMA 200", ind.ema200], ["EMA 50", ind.ema50], ["RSI 14", ind.rsi14], ["ATR 14", ind.atr14]] as const) {
      if (value === null) missing.push(`${name} on ${t.timeframe} (not enough history)`);
    }
    if (ind.volatility === "UNKNOWN") missing.push(`volatility regime on ${t.timeframe}`);
    const level = (l: { price: number; touches: number; distanceAtr: number | null }) => ({
      price: round(l.price, p),
      touches: l.touches,
      distanceAtr: r2(l.distanceAtr),
    });
    return {
      timeframe: t.timeframe,
      candles: t.candleCount,
      ema20: px(ind.ema20),
      ema50: px(ind.ema50),
      ema200: px(ind.ema200),
      emaTrend: t.emaTrend,
      rsi14: ind.rsi14 === null ? null : round(ind.rsi14, 1),
      atr14: px(ind.atr14),
      atrPercent: ind.atrPercent === null ? null : round(ind.atrPercent, 3),
      volatility: ind.volatility,
      structure: t.structure.bias,
      structureReason: t.structure.reason,
      recentSwingHighs: t.recentSwingHighs.map((v) => round(v, p)),
      recentSwingLows: t.recentSwingLows.map((v) => round(v, p)),
      support: t.support.map(level),
      resistance: t.resistance.map(level),
    };
  });

  if (market.price.spread === null) missing.push("spread (not reported by the data provider)");

  const structure: ClaudePayload["structure"] = {};
  for (const t of market.timeframes) structure[t.timeframe.toLowerCase() as Lowercase<Timeframe>] = t.structure.bias;

  return {
    pair: instrument.symbol,
    instrument: { assetClass: instrument.assetClass, pipSize: instrument.pipSize, pricePrecision: instrument.pricePrecision },
    direction: trade.direction,
    timeframe: trade.timeframe,
    entry: trade.entry,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    risk: {
      riskPercent: round(calculation.riskPercent, 3),
      riskAmount: calculation.riskAmount,
      rewardAmount: calculation.rewardAmount,
      riskReward: round(calculation.riskReward, 2),
      riskPips: calculation.riskPips,
      rewardPips: calculation.rewardPips,
      positionSizeLots: calculation.positionSize,
      accountCurrency: calculation.accountCurrency,
      riskEngineStatus: risk.status,
      riskEngineWarnings: risk.checks.filter((c) => c.status === "WARNING").map((c) => `${c.label}: ${c.detail}`),
    },
    market: {
      price: market.price.mid,
      bid: market.price.bid,
      ask: market.price.ask,
      spread: market.price.spread,
      spreadPips: market.price.spread === null ? null : round(market.price.spread / instrument.pipSize, 1),
      dataSource: market.providerName,
      syntheticData: market.isMock,
    },
    structure,
    timeframes,
    derived: {
      atrTradeTimeframe: px(context.atr),
      entryRelation: context.entryRelation,
      entryDistanceAtr: r2(context.entryDistanceAtr),
      stopDistanceAtr: r2(context.stopDistanceAtr),
      targetDistanceAtr: r2(context.targetDistanceAtr),
      levelsBetweenEntryAndTarget: context.levelsBetweenEntryAndTarget.map((l) => ({ ...l, price: round(l.price, p) })),
      referenceSwing: px(context.referenceSwing),
      stopBeyondRecentSwing: context.stopBeyondRecentSwing,
    },
    marketChecks: marketChecks.map((c) => ({ check: c.label, status: c.status, detail: c.detail })),
    missingData: missing,
    userThesis: (trade.thesis ?? "").trim(),
  };
}
