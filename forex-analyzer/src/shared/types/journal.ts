import type { AiVerdict } from "@/shared/types/ai";
import type { AnalysisResult, AnalysisState, FinalVerdict } from "@/shared/types/analysis";
import type { Direction, Timeframe } from "@/shared/types/trade";

export const JOURNAL_STATUSES = ["PENDING", "OPEN", "CLOSED"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const TRADE_RESULTS = ["WIN", "LOSS", "BREAKEVEN", "CANCELLED"] as const;
export type TradeResult = (typeof TRADE_RESULTS)[number];

export interface JournalSummary {
  id: string;
  createdAt: string;
  pair: string;
  direction: Direction;
  timeframe: Timeframe;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number | null;
  riskPercent: number | null;
  riskAmount: number | null;
  rewardAmount: number | null;
  riskReward: number | null;
  accountCurrency: string;
  state: AnalysisState;
  finalVerdict: FinalVerdict;
  aiVerdict: AiVerdict | null;
  aiScore: number | null;
  aiProvider: string | null;
  status: JournalStatus;
  result: TradeResult | null;
  actualPnl: number | null;
  rMultiple: number | null;
  closedAt: string | null;
}

export interface JournalEntry extends JournalSummary {
  thesis: string;
  outcomeNotes: string;
  openedAt: string | null;
  updatedAt: string;
  analysis: AnalysisResult;
}

export interface OutcomeUpdate {
  status: JournalStatus;
  result: TradeResult | null;
  actualPnl: number | null;
  rMultiple: number | null;
  notes: string;
  closedAt?: string | null;
}

export interface JournalFilters {
  pair?: string;
  verdict?: FinalVerdict;
  minScore?: number;
  maxScore?: number;
  result?: TradeResult | "OPEN" | "PENDING";
  from?: string;
  to?: string;
}
