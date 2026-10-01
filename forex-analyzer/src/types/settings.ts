export const ACCOUNT_CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type AccountCurrency = (typeof ACCOUNT_CURRENCIES)[number];

export const TRADING_SESSIONS = ["SYDNEY", "TOKYO", "LONDON", "NEW_YORK"] as const;
export type TradingSession = (typeof TRADING_SESSIONS)[number];

/** How the daily loss allowance is sized. Prop firms differ; the user picks. */
export const DAILY_LOSS_BASES = ["INITIAL_BALANCE", "DAY_START_BALANCE"] as const;
export type DailyLossBasis = (typeof DAILY_LOSS_BASES)[number];

/** STATIC: floor fixed below the initial balance. TRAILING: floor follows the closed-balance high. */
export const DRAWDOWN_MODES = ["STATIC", "TRAILING"] as const;
export type DrawdownMode = (typeof DRAWDOWN_MODES)[number];

/** JOURNAL: balance, today's P/L and open positions come from the journal. MANUAL: entered below. */
export const ACCOUNT_STATE_SOURCES = ["JOURNAL", "MANUAL"] as const;
export type AccountStateSource = (typeof ACCOUNT_STATE_SOURCES)[number];

export interface ManualAccountState {
  balance: number;
  todayRealizedPnl: number;
  openPositions: number;
  /** Money that would be lost if every open position hit its stop. */
  openRisk: number;
  /** Highest closed balance, used only by TRAILING drawdown. */
  highWaterMark: number;
}

/** User-configurable account parameters. None of these are assumed to be universal prop-firm rules. */
export interface AccountSettings {
  accountSize: number;
  currency: AccountCurrency;

  maxDailyLossPct: number;
  dailyLossBasis: DailyLossBasis;
  maxDrawdownPct: number;
  drawdownMode: DrawdownMode;
  maxRiskPerTradePct: number;
  maxOpenPositions: number;
  minRiskReward: number;

  allowedPairs: string[];
  tradingSessions: TradingSession[];
  minSetupScore: number;

  /** IANA time zone in which the trading day resets (e.g. "UTC", "Europe/Prague"). */
  dayResetTimeZone: string;

  accountStateSource: AccountStateSource;
  manualState: ManualAccountState;
}
