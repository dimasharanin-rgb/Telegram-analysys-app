import type { Quote } from "./market";
import type { SetupCandidate } from "./setup";
import type { Direction } from "./trade";

export const AUTONOMOUS_RATINGS = ["GOOD", "MODERATE", "POOR", "CONFLICTING", "UNCLEAR", "UNKNOWN"] as const;
export type AutonomousRating = (typeof AUTONOMOUS_RATINGS)[number];

/** Claude's structured evaluation of a setup candidate. `setupQuality` is a heuristic, NOT a probability. */
export interface CandidateEvaluation {
  decision: "TRADE" | "NO_TRADE";
  direction: Direction;
  setupQuality: number;
  trade: { entry: number; stopLoss: number; takeProfit: number } | null;
  /** Claude's own arithmetic. Never authoritative; the app recalculates. */
  riskAssessment: { riskDistance: number; rewardDistance: number; rr: number } | null;
  technicalAssessment: {
    trendAlignment: AutonomousRating;
    marketStructure: AutonomousRating;
    momentum: AutonomousRating;
    entryQuality: AutonomousRating;
    stopPlacement: AutonomousRating;
    targetPlacement: AutonomousRating;
  };
  positiveFactors: string[];
  warnings: string[];
  contradictingFactors: string[];
  invalidation: string[];
  summary: string;
}

/** Market facts the candidate was detected from, kept with it so a later analysis cannot use anything newer. */
export interface CandidateSnapshotMeta {
  asOf: number;
  source: string;
  sourceName: string;
  mode: "LIVE" | "MOCK";
  retrievedAt: number;
  dataTimestamp: number;
  price: Quote;
}

export interface StoredCandidate {
  candidate: SetupCandidate;
  snapshot: CandidateSnapshotMeta;
}

export interface RiskValidation {
  /** Whether the deterministic engine accepted the proposal. Claude cannot change this. */
  passed: boolean;
  calculatedRiskPercent: number | null;
  calculatedRiskAmount: number | null;
  calculatedRR: number | null;
  positionSizeLots: number | null;
  accountCurrency: string;
  failures: string[];
  warnings: string[];
  /** Where Claude's own numbers disagreed with the calculation (informational). */
  discrepancies: string[];
}

export interface AutonomousAnalysisResult {
  id: string;
  candidateId: string;
  analyzedAt: number;
  symbol: string;
  timeframe: string;
  setupType: string;
  candidateDirection: Direction;
  snapshotAsOf: number;
  snapshotSource: string;
  promptVersion: string;
  model: string;
  servedBy: string | null;
  /** Null when the AI did not produce a valid answer (see `error`). */
  aiDecision: "TRADE" | "NO_TRADE" | null;
  setupQuality: number | null;
  proposedTrade: { direction: Direction; entry: number; stopLoss: number; takeProfit: number } | null;
  /** Null when there was no proposal to validate. */
  riskValidation: RiskValidation | null;
  /** TRADE only when the AI proposed a trade AND the deterministic risk validation passed. */
  finalDecision: "TRADE" | "NO_TRADE";
  finalReason: string;
  analysis: CandidateEvaluation | null;
  error: { stage: "DATA" | "AI"; code: string; message: string } | null;
  /** True when an identical earlier analysis was reused instead of calling the AI again. */
  cached: boolean;
}
