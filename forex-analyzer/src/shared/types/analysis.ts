import type { AiAssessment, AiRunInfo, AiVerdict } from "@/shared/types/ai";
import type { Candle, Quote } from "@/shared/types/market";
import type { CheckStatus, RiskReport } from "@/shared/types/risk";
import type { AccountSettings } from "@/shared/types/settings";
import type { TimeframeAnalysis } from "@/shared/types/technical";
import type { Timeframe, TradeInput } from "@/shared/types/trade";

export type AnalysisState = "BLOCKED" | "UNAVAILABLE" | "ANALYZED";
export type FinalVerdict = "BLOCKED" | "UNAVAILABLE" | AiVerdict;

export type MarketCheckId = "SPREAD" | "ENTRY_DISTANCE" | "STOP_VS_ATR";

/** Deterministic checks that need live market data. Never BLOCK; data problems make the analysis UNAVAILABLE instead. */
export interface MarketCheck {
  id: MarketCheckId;
  label: string;
  status: Exclude<CheckStatus, "BLOCK">;
  detail: string;
  /** Whether a WARNING here caps the final verdict at CAUTION (a data gap such as an unreported spread does not). */
  capsVerdict: boolean;
}

/** Deterministic facts relating the proposed trade to the market, computed before any AI call. */
export interface TradeContext {
  tradeTimeframe: Timeframe;
  atr: number | null;
  entryRelation: "AT_MARKET" | "ABOVE_MARKET" | "BELOW_MARKET";
  entryDistanceAtr: number | null;
  stopDistanceAtr: number | null;
  targetDistanceAtr: number | null;
  /** Opposing levels (resistance for a LONG, support for a SHORT) lying between entry and target. */
  levelsBetweenEntryAndTarget: { timeframe: Timeframe; price: number; touches: number }[];
  /** The most recent swing low (LONG) or high (SHORT) on the trade timeframe that the stop is compared against. */
  referenceSwing: number | null;
  /** Whether the stop sits beyond that swing. Null when there is no swing to compare with. */
  stopBeyondRecentSwing: boolean | null;
  spreadToStopRatio: number | null;
}

export interface MarketSnapshot {
  provider: string;
  providerName: string;
  isMock: boolean;
  fetchedAt: number;
  price: Quote;
  /** Highest timeframe first. */
  timeframes: TimeframeAnalysis[];
  /** Candles per analysed timeframe, for the chart. */
  candles: Partial<Record<Timeframe, Candle[]>>;
}

export interface UnavailableReason {
  stage: "MARKET_DATA" | "AI";
  code: string;
  message: string;
}

export interface Decision {
  finalVerdict: FinalVerdict;
  headline: string;
  /** Why the final verdict is what it is: blocking checks, missing data, or caps applied to the AI verdict. */
  reasons: string[];
  aiVerdict: AiVerdict | null;
  /** True when application rules lowered the AI's verdict. They can only lower it, never raise it. */
  capped: boolean;
}

export interface AnalysisResult {
  id: string | null;
  createdAt: string;
  trade: TradeInput;
  state: AnalysisState;
  risk: RiskReport;
  market: MarketSnapshot | null;
  marketChecks: MarketCheck[];
  context: TradeContext | null;
  ai: { info: AiRunInfo; assessment: AiAssessment } | null;
  unavailable: UnavailableReason | null;
  decision: Decision;
  settings: AccountSettings;
}
