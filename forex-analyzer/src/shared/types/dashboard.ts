import type { AccountLimitsSnapshot, AccountState } from "@/shared/types/risk";
import type { JournalSummary, TradeResult } from "@/shared/types/journal";

export interface JournalStats {
  analyses: number;
  accepted: number;
  caution: number;
  rejected: number;
  blocked: number;
  unavailable: number;
  wins: number;
  losses: number;
  breakeven: number;
  cancelled: number;
  open: number;
  averageAiScore: number | null;
  averageR: number | null;
}

export interface ScoreOutcomePoint {
  id: string;
  score: number;
  rMultiple: number | null;
  result: Exclude<TradeResult, "CANCELLED">;
}

export interface ScoreBucket {
  label: string;
  min: number;
  max: number;
  trades: number;
  wins: number;
  averageR: number | null;
}

/**
 * AI score against recorded outcomes. Descriptive only: nothing here claims the
 * score predicts anything, and nothing is summarised until `sufficient` is true.
 */
export interface ScoreVsOutcome {
  sampleSize: number;
  minimumSample: number;
  sufficient: boolean;
  points: ScoreOutcomePoint[];
  buckets: ScoreBucket[];
  /** Spearman rank correlation between score and R multiple; only with a sufficient sample. */
  rankCorrelation: number | null;
}

export interface DashboardData {
  currency: string;
  account: AccountState;
  limits: AccountLimitsSnapshot;
  stats: JournalStats;
  scoreVsOutcome: ScoreVsOutcome;
  recent: JournalSummary[];
}
