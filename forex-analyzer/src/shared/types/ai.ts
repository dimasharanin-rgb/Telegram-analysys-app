export const AI_VERDICTS = ["ACCEPTABLE", "CAUTION", "REJECT"] as const;
export type AiVerdict = (typeof AI_VERDICTS)[number];

export const RATINGS = ["GOOD", "MODERATE", "POOR", "UNKNOWN"] as const;
export type Rating = (typeof RATINGS)[number];

export const DIRECTIONAL_BIASES = ["BULLISH", "BEARISH", "NEUTRAL", "UNKNOWN"] as const;
export type DirectionalBias = (typeof DIRECTIONAL_BIASES)[number];

export const RISK_LEVELS = ["ACCEPTABLE", "ELEVATED", "HIGH", "UNKNOWN"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const SCORE_COMPONENTS = [
  "trendAlignment",
  "marketStructure",
  "momentum",
  "entryQuality",
  "riskReward",
  "volatility",
  "higherTimeframeAlignment",
] as const;
export type ScoreComponentKey = (typeof SCORE_COMPONENTS)[number];

export const SCORE_COMPONENT_LABELS: Record<ScoreComponentKey, string> = {
  trendAlignment: "Trend alignment",
  marketStructure: "Market structure",
  momentum: "Momentum",
  entryQuality: "Entry quality",
  riskReward: "Risk/reward",
  volatility: "Volatility",
  higherTimeframeAlignment: "Higher-timeframe alignment",
};

export interface ScoreComponent {
  /** 0-100, or null when the data needed to judge it was missing (rating UNKNOWN). */
  score: number | null;
  rating: Rating;
  note: string;
}

export interface PlacementAssessment {
  rating: Rating;
  note: string;
}

/**
 * The model's structured evaluation of a proposed setup. `setupQuality` is a
 * heuristic quality score, NOT a probability of the trade succeeding.
 */
export interface AiAssessment {
  verdict: AiVerdict;
  setupQuality: number;
  directionalBias: DirectionalBias;
  technicalAssessment: {
    score: number | null;
    trendAlignment: Rating;
    momentum: Rating;
    structure: Rating;
    entryQuality: Rating;
  };
  riskAssessment: {
    score: number | null;
    riskReward: number | null;
    riskLevel: RiskLevel;
  };
  scoreBreakdown: Record<ScoreComponentKey, ScoreComponent>;
  stopPlacement: PlacementAssessment;
  targetPlacement: PlacementAssessment;
  warnings: string[];
  positiveFactors: string[];
  conflictingSignals: string[];
  invalidation: string[];
  summary: string;
}

export type AiProviderId = "anthropic" | "mock";

export interface AiRunInfo {
  provider: AiProviderId;
  model: string;
  /** Model that actually produced the answer, if the API fell back to another one. */
  servedBy: string;
  durationMs: number;
  /** Deterministic notes the app attached after validating the output. */
  notes: string[];
}
