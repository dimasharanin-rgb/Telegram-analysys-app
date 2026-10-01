import type { AccountSettings } from "@/shared/types/settings";
import { DEFAULT_SYMBOLS } from "./instruments";

/** Starting values only. Funded-account rules differ between firms; every one of these is editable. */
export const DEFAULT_SETTINGS: AccountSettings = {
  accountSize: 10_000,
  currency: "USD",
  maxDailyLossPct: 5,
  dailyLossBasis: "INITIAL_BALANCE",
  maxDrawdownPct: 10,
  drawdownMode: "STATIC",
  maxRiskPerTradePct: 0.5,
  maxOpenPositions: 1,
  minRiskReward: 2,
  allowedPairs: [...DEFAULT_SYMBOLS],
  tradingSessions: ["LONDON", "NEW_YORK"],
  minSetupScore: 60,
  dayResetTimeZone: "UTC",
  accountStateSource: "MANUAL",
  manualState: {
    balance: 10_000,
    equity: 10_000,
    todayRealizedPnl: 0,
    todayUnrealizedPnl: 0,
    openPositions: 0,
    openRisk: 0,
    highWaterMark: 10_000,
  },
  dataMode: "LIVE",
  freshnessThresholdSeconds: 120,
  developerMode: false,
};
