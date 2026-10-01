import type { TimeframeAnalysis } from "./technical";
import type { Direction, Timeframe } from "./trade";

export const SETUP_TYPES = ["CONTINUATION", "PULLBACK", "BREAKOUT", "REVERSAL", "OTHER"] as const;
export type SetupType = (typeof SETUP_TYPES)[number];

/** One deterministic condition the detector checked, and whether it held. */
export interface SetupCondition {
  name: string;
  met: boolean;
  /** Conditions marked required must all hold for a candidate to be emitted. */
  required: boolean;
  detail: string;
}

/** Structural reference points a later stage may use; the detector does not turn them into SL/TP. */
export interface SetupReferenceLevels {
  nearestSupport: number | null;
  nearestResistance: number | null;
  recentSwingLow: number | null;
  recentSwingHigh: number | null;
  atr14: number | null;
}

/**
 * A technically interesting situation worth a closer look. It is NOT a trade:
 * no entry, stop, target or size, and no judgement on whether to take it.
 */
export interface SetupCandidate {
  /** Deterministic: the same snapshot always gives the same id. */
  id: string;
  symbol: string;
  /** The market moment the candidate describes (unix ms). */
  asOf: number;
  direction: Direction;
  setupType: SetupType;
  timeframe: Timeframe;
  /** Higher timeframes used as context. */
  contextTimeframes: Timeframe[];
  /** For breakouts: the level being approached or broken. */
  triggerPrice?: number;
  referenceLevels: SetupReferenceLevels;
  reasons: string[];
  invalidationConditions: string[];
  conditions: SetupCondition[];
  /**
   * Share of all checked conditions that hold (0-1): how complete the pattern
   * is. It is not a probability of anything.
   */
  completeness: number;
  /** The facts the detector used (entry and context timeframes), without candles. */
  marketContext: TimeframeAnalysis[];
}

export interface SetupDetectionConfig {
  enabled: boolean;
  allowedTimeframes: Timeframe[];
  allowedSetupTypes: SetupType[];
  /** Empty = any symbol. */
  allowedSymbols: string[];
  /** Ignore markets quieter than this ATR as a percent of price. */
  minimumAtrPercent: number | null;
  /** Continuations require EMA20/50/200 stacked in the setup's direction. */
  requireTrendAlignment: boolean;
  /** Continuations and pullbacks require higher-timeframe structure/trend to agree. */
  requireHigherTimeframeAgreement: boolean;
  /** "Near a level": within this many ATRs of support/resistance or EMA20/50. */
  maxDistanceFromLevelAtr: number;
  /** Breakouts need the recent range to be at most this many ATRs (compression). */
  compressionMaxRangeAtr: number;
  /** Drop candidates whose completeness is below this (0-1). */
  minimumCompleteness: number;
}

export interface SymbolScanStatus {
  symbol: string;
  status: "OK" | "UNAVAILABLE";
  reason?: string;
  candidates: number;
}

export interface ScanResult {
  scannedAt: number;
  /** Per symbol: when its data was taken and the price at that moment. */
  snapshots: Record<string, import("./autonomous").CandidateSnapshotMeta>;
  timeframes: Timeframe[];
  symbols: SymbolScanStatus[];
  /** Unranked. An empty list is a normal result. */
  candidates: SetupCandidate[];
}
