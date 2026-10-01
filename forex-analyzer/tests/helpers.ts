import type { AccountState } from "@/shared/types/risk";
import type { AccountSettings } from "@/shared/types/settings";
import type { TradeInput } from "@/shared/types/trade";
import { DEFAULT_SETTINGS } from "@/shared/defaults";
import { runRiskEngine } from "@/risk";

/** 11:00 UTC on a Wednesday: London session is open. */
export const LONDON_NOON = new Date("2026-09-30T11:00:00Z");

export function settings(patch: Partial<AccountSettings> = {}): AccountSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), ...patch };
}

export function account(patch: Partial<AccountState> = {}): AccountState {
  const balance = patch.balance ?? 10_000;
  return {
    equity: patch.equity ?? balance,
    source: "MANUAL",
    initialBalance: 10_000,
    balance: 10_000,
    dayStartBalance: 10_000,
    todayRealizedPnl: 0,
    highWaterMark: 10_000,
    openPositions: 0,
    openRisk: 0,
    ...patch,
  };
}

export function trade(patch: Partial<TradeInput> = {}): TradeInput {
  return {
    pair: "EURUSD",
    direction: "LONG",
    entry: 1.1735,
    stopLoss: 1.1715,
    takeProfit: 1.1775,
    timeframe: "M15",
    ...patch,
  };
}

export function quotes(map: Record<string, number> = {}) {
  return (symbol: string) => map[symbol];
}

export function risk(
  t: Partial<TradeInput> = {},
  opts: { settings?: Partial<AccountSettings>; account?: Partial<AccountState>; quotes?: Record<string, number>; now?: Date } = {},
) {
  return runRiskEngine({
    trade: trade(t),
    settings: settings(opts.settings),
    account: account(opts.account),
    quotes: quotes(opts.quotes),
    now: opts.now ?? LONDON_NOON,
  });
}

export function check(report: ReturnType<typeof risk>, id: string) {
  const c = report.checks.find((x) => x.id === id);
  if (!c) throw new Error(`check ${id} not present: ${report.checks.map((x) => x.id).join(", ")}`);
  return c;
}
