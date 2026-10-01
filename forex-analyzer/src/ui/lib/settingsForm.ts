import type { AccountSettings } from "@/shared/types/settings";
import { fieldErrors, settingsSchema } from "@/shared/schemas";

/** Settings as edited in the form: numbers are kept as strings until saved. */
export interface SettingsFormValues {
  accountSize: string;
  currency: AccountSettings["currency"];
  maxDailyLossPct: string;
  dailyLossBasis: AccountSettings["dailyLossBasis"];
  maxDrawdownPct: string;
  drawdownMode: AccountSettings["drawdownMode"];
  maxRiskPerTradePct: string;
  maxOpenPositions: string;
  minRiskReward: string;
  allowedPairs: string[];
  tradingSessions: AccountSettings["tradingSessions"];
  minSetupScore: string;
  dayResetTimeZone: string;
  accountStateSource: AccountSettings["accountStateSource"];
  dataMode: AccountSettings["dataMode"];
  freshnessThresholdSeconds: string;
  developerMode: boolean;
  manualState: {
    balance: string;
    equity: string;
    todayRealizedPnl: string;
    todayUnrealizedPnl: string;
    openPositions: string;
    openRisk: string;
    highWaterMark: string;
  };
}

export function toSettingsForm(s: AccountSettings): SettingsFormValues {
  const str = (n: number) => String(n);
  return {
    accountSize: str(s.accountSize),
    currency: s.currency,
    maxDailyLossPct: str(s.maxDailyLossPct),
    dailyLossBasis: s.dailyLossBasis,
    maxDrawdownPct: str(s.maxDrawdownPct),
    drawdownMode: s.drawdownMode,
    maxRiskPerTradePct: str(s.maxRiskPerTradePct),
    maxOpenPositions: str(s.maxOpenPositions),
    minRiskReward: str(s.minRiskReward),
    allowedPairs: [...s.allowedPairs],
    tradingSessions: [...s.tradingSessions],
    minSetupScore: str(s.minSetupScore),
    dayResetTimeZone: s.dayResetTimeZone,
    accountStateSource: s.accountStateSource,
    dataMode: s.dataMode,
    freshnessThresholdSeconds: str(s.freshnessThresholdSeconds),
    developerMode: s.developerMode,
    manualState: {
      balance: str(s.manualState.balance),
      equity: str(s.manualState.equity),
      todayRealizedPnl: str(s.manualState.todayRealizedPnl),
      todayUnrealizedPnl: str(s.manualState.todayUnrealizedPnl),
      openPositions: str(s.manualState.openPositions),
      openRisk: str(s.manualState.openRisk),
      highWaterMark: str(s.manualState.highWaterMark),
    },
  };
}

/** Empty input becomes NaN so the schema reports it instead of silently using 0. */
function toNumber(v: string): number {
  return v.trim() === "" ? Number.NaN : Number(v.replace(/,/g, ""));
}

export function fromSettingsForm(v: SettingsFormValues): { settings: AccountSettings | null; errors: Record<string, string> } {
  const candidate = {
    ...v,
    accountSize: toNumber(v.accountSize),
    maxDailyLossPct: toNumber(v.maxDailyLossPct),
    maxDrawdownPct: toNumber(v.maxDrawdownPct),
    maxRiskPerTradePct: toNumber(v.maxRiskPerTradePct),
    maxOpenPositions: toNumber(v.maxOpenPositions),
    minRiskReward: toNumber(v.minRiskReward),
    minSetupScore: toNumber(v.minSetupScore),
    freshnessThresholdSeconds: toNumber(v.freshnessThresholdSeconds),
    manualState: {
      balance: toNumber(v.manualState.balance),
      equity: toNumber(v.manualState.equity),
      todayRealizedPnl: toNumber(v.manualState.todayRealizedPnl),
      todayUnrealizedPnl: toNumber(v.manualState.todayUnrealizedPnl),
      openPositions: toNumber(v.manualState.openPositions),
      openRisk: toNumber(v.manualState.openRisk),
      highWaterMark: toNumber(v.manualState.highWaterMark),
    },
  };
  const result = settingsSchema.safeParse(candidate);
  return result.success ? { settings: result.data, errors: {} } : { settings: null, errors: fieldErrors(result.error) };
}
