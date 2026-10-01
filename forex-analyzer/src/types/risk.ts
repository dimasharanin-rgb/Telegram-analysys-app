import type { Direction } from "./trade";

export type CheckStatus = "PASS" | "WARNING" | "BLOCK";

export type RiskCheckId =
  | "PAIR_KNOWN"
  | "PAIR_ALLOWED"
  | "DIRECTION_VALID"
  | "PRICES_VALID"
  | "STOP_LOSS_SIDE"
  | "TAKE_PROFIT_SIDE"
  | "POSITION_SIZE"
  | "RISK_PER_TRADE"
  | "RISK_REWARD"
  | "DAILY_LOSS"
  | "MAX_DRAWDOWN"
  | "POSITION_LIMIT"
  | "TRADING_SESSION"
  | "CONVERSION_RATE";

export interface RiskCheck {
  id: RiskCheckId;
  label: string;
  status: CheckStatus;
  detail: string;
}

/** Account figures the limit checks need, from the journal or entered manually. */
export interface AccountState {
  source: "JOURNAL" | "MANUAL";
  initialBalance: number;
  balance: number;
  dayStartBalance: number;
  todayRealizedPnl: number;
  highWaterMark: number;
  openPositions: number;
  openRisk: number;
}

/** What the funded-account limits leave room for before this trade. */
export interface AccountLimitsSnapshot {
  dailyLossLimit: number;
  dailyLossFloor: number;
  dailyLossRemaining: number;
  drawdownLimit: number;
  drawdownFloor: number;
  drawdownRemaining: number;
  maxRiskAmount: number;
  positionsRemaining: number;
}

export interface RiskCalculation {
  direction: Direction;
  riskDistance: number;
  rewardDistance: number;
  riskPips: number;
  rewardPips: number;
  riskReward: number;
  /** Lots used for the money figures below. */
  positionSize: number;
  positionSizeSource: "USER" | "SUGGESTED";
  /** Largest size (lots, rounded down to the lot step) that keeps risk within the per-trade limit. */
  suggestedPositionSize: number;
  units: number;
  riskAmount: number;
  rewardAmount: number;
  /** Risk as a percent of current balance. */
  riskPercent: number;
  /** Value of one pip for one lot at the entry price, in account currency. */
  pipValuePerLot: number;
  accountCurrency: string;
  /** How quote-currency P/L was converted to the account currency. */
  conversion: ConversionDescription;
}

export type ConversionDescription =
  | { kind: "IDENTITY" }
  | { kind: "INVERSE_OF_PAIR"; note: string }
  | { kind: "CROSS_RATE"; via: string; rate: number };

export type RiskReportStatus = "PASS" | "WARNING" | "BLOCKED";

export interface RiskReport {
  status: RiskReportStatus;
  checks: RiskCheck[];
  /** Null when the trade is structurally invalid and nothing could be computed. */
  calculation: RiskCalculation | null;
  limits: AccountLimitsSnapshot;
  account: AccountState;
}
