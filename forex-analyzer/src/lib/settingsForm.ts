import type { AccountSettings } from "@/types/settings";
import { fieldErrors, settingsSchema } from "./schemas";

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
  manualState: {
    balance: string;
    todayRealizedPnl: string;
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
    manualState: {
      balance: str(s.manualState.balance),
      todayRealizedPnl: str(s.manualState.todayRealizedPnl),
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
    manualState: {
      balance: toNumber(v.manualState.balance),
      todayRealizedPnl: toNumber(v.manualState.todayRealizedPnl),
      openPositions: toNumber(v.manualState.openPositions),
      openRisk: toNumber(v.manualState.openRisk),
      highWaterMark: toNumber(v.manualState.highWaterMark),
    },
  };
  const result = settingsSchema.safeParse(candidate);
  return result.success ? { settings: result.data, errors: {} } : { settings: null, errors: fieldErrors(result.error) };
}
