import type { AccountState } from "@/types/risk";
import type { AccountSettings } from "@/types/settings";
import { round } from "@/lib/math";
import { dateInTimeZone } from "@/lib/time";

export interface ClosedTradeRecord {
  closedAt: string;
  pnl: number;
}

export interface OpenTradeRecord {
  riskAmount: number;
}

/**
 * Account figures for the limit checks. In JOURNAL mode they are derived from
 * outcomes the user recorded; in MANUAL mode they are what the user typed in.
 * Either way the app never connects to a broker to find out.
 */
export function deriveAccountState(
  settings: AccountSettings,
  journal: { closed: ClosedTradeRecord[]; open: OpenTradeRecord[] },
  now: Date,
): AccountState {
  if (settings.accountStateSource === "MANUAL") {
    const m = settings.manualState;
    return {
      source: "MANUAL",
      initialBalance: settings.accountSize,
      balance: m.balance,
      dayStartBalance: round(m.balance - m.todayRealizedPnl, 2),
      todayRealizedPnl: m.todayRealizedPnl,
      highWaterMark: Math.max(m.highWaterMark, m.balance, settings.accountSize),
      openPositions: m.openPositions,
      openRisk: m.openRisk,
    };
  }

  const today = dateInTimeZone(now, settings.dayResetTimeZone);
  const closed = [...journal.closed].sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  let balance = settings.accountSize;
  let highWaterMark = settings.accountSize;
  let todayPnl = 0;
  for (const t of closed) {
    balance += t.pnl;
    highWaterMark = Math.max(highWaterMark, balance);
    if (dateInTimeZone(new Date(t.closedAt), settings.dayResetTimeZone) === today) todayPnl += t.pnl;
  }

  return {
    source: "JOURNAL",
    initialBalance: settings.accountSize,
    balance: round(balance, 2),
    dayStartBalance: round(balance - todayPnl, 2),
    todayRealizedPnl: round(todayPnl, 2),
    highWaterMark: round(highWaterMark, 2),
    openPositions: journal.open.length,
    openRisk: round(journal.open.reduce((s, t) => s + t.riskAmount, 0), 2),
  };
}
