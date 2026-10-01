import type { StoredCandidate } from "@/shared/types/autonomous";
import type { AccountLimitsSnapshot, AccountState } from "@/shared/types/risk";
import type { AccountSettings } from "@/shared/types/settings";
import type { TimeframeAnalysis } from "@/shared/types/technical";
import { getInstrument } from "@/shared/instruments";
import { round } from "@/shared/math";

/**
 * Structured input for the candidate evaluation. Built only from facts frozen
 * at the candidate's `asOf` (no candles at all), plus the account's limits.
 * Throws if any fact is newer than `asOf`, so the AI can never be shown the future.
 */
export function buildCandidatePayload(stored: StoredCandidate, account: { settings: AccountSettings; state: AccountState; limits: AccountLimitsSnapshot }) {
  const { candidate, snapshot } = stored;
  const asOf = candidate.asOf;
  for (const tf of candidate.marketContext) {
    if (tf.lastCandleTime > asOf) throw new Error(`Refusing to build an AI payload: ${tf.timeframe} data is newer than the candidate time.`);
  }
  if (snapshot.price.timestamp > asOf + 120_000) throw new Error("Refusing to build an AI payload: the price is newer than the candidate time.");

  const instrument = getInstrument(candidate.symbol);
  const p = (instrument?.pricePrecision ?? 5) + 1;
  const px = (v: number | null | undefined) => (v == null ? null : round(v, p));
  const r2 = (v: number | null | undefined) => (v == null ? null : round(v, 2));

  const timeframe = (t: TimeframeAnalysis) => ({
    timeframe: t.timeframe,
    ema20: px(t.indicators.ema20),
    ema50: px(t.indicators.ema50),
    ema200: px(t.indicators.ema200),
    rsi14: r2(t.momentum.rsi14),
    momentum: t.momentum.state,
    rsiChange: r2(t.momentum.rsiChange),
    atr14: px(t.volatility.atr14),
    atrPercent: t.volatility.atrPercent == null ? null : round(t.volatility.atrPercent, 3),
    volatility: t.volatility.state,
    recentRangeAtr: r2(t.volatility.recentRangeAtr),
    trend: { ...t.trend, distanceFromEma20Atr: r2(t.trend.distanceFromEma20Atr), distanceFromEma50Atr: r2(t.trend.distanceFromEma50Atr) },
    structure: t.structure.bias,
    structureSequence: t.structure.sequence,
    structureReason: t.structure.reason,
    recentSwingHighs: t.recentSwingHighs.map((v) => round(v, p)),
    recentSwingLows: t.recentSwingLows.map((v) => round(v, p)),
    support: t.support.map((l) => ({ price: round(l.price, p), strength: l.strength, source: l.source, distanceAtr: r2(l.distanceAtr) })),
    resistance: t.resistance.map((l) => ({ price: round(l.price, p), strength: l.strength, source: l.source, distanceAtr: r2(l.distanceAtr) })),
  });

  const { settings, state, limits } = account;
  return {
    market: {
      symbol: candidate.symbol,
      asOf: new Date(asOf).toISOString(),
      price: px(snapshot.price.mid),
      bid: px(snapshot.price.bid),
      ask: px(snapshot.price.ask),
      spread: px(snapshot.price.spread),
      timeframe: candidate.timeframe,
      contextTimeframes: candidate.contextTimeframes,
      dataSource: snapshot.sourceName,
      syntheticData: snapshot.mode === "MOCK",
    },
    technical: candidate.marketContext.map(timeframe),
    candidate: {
      direction: candidate.direction,
      setupType: candidate.setupType,
      triggerPrice: px(candidate.triggerPrice),
      referenceLevels: Object.fromEntries(Object.entries(candidate.referenceLevels).map(([k, v]) => [k, px(v)])),
      conditions: candidate.conditions.map((c) => ({ name: c.name, met: c.met, detail: c.detail })),
      reasons: candidate.reasons,
      invalidation: candidate.invalidationConditions,
    },
    account: {
      currency: settings.currency,
      balance: state.balance,
      equity: state.equity,
      maxRiskPerTradePct: settings.maxRiskPerTradePct,
      maxDailyLossPct: settings.maxDailyLossPct,
      maxTotalDrawdownPct: settings.maxDrawdownPct,
      minRiskReward: settings.minRiskReward,
      maxOpenPositions: settings.maxOpenPositions,
      openPositions: state.openPositions,
      dailyLossRemaining: limits.dailyLossRemaining,
      drawdownRemaining: limits.drawdownRemaining,
    },
    instrument: { pipSize: instrument?.pipSize ?? null, pricePrecision: instrument?.pricePrecision ?? null },
  };
}

export type CandidatePayload = ReturnType<typeof buildCandidatePayload>;
