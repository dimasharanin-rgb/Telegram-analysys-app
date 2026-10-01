import type { AiAssessment, AiRunInfo } from "@/shared/types/ai";
import type { ClaudePayload } from "@/ai/payload";

export interface AnalystResult {
  assessment: AiAssessment;
  info: AiRunInfo;
}

/** Something that turns a structured payload into a validated assessment: Claude, or the offline mock. */
export interface TradeAnalyst {
  readonly provider: AiRunInfo["provider"];
  readonly model: string;
  analyze(payload: ClaudePayload): Promise<AnalystResult>;
}
