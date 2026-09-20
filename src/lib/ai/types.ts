/**
 * Provider-agnostic analysis service.
 *
 * The pipeline depends on this interface only. `ClaudeAnalysisService` is the
 * one implementation today; adding another provider means adding a class here,
 * not touching the pipeline or the routes.
 */

import type {
  Analysis,
  AnalysisRequest,
  ChunkFindings,
  Excerpt,
  StatisticsDigest,
} from "./schema";

export interface ParticipantRef {
  id: string;
  label: string;
}

export interface AnalysisContext {
  participants: ParticipantRef[];
  statistics: StatisticsDigest;
  signal?: AbortSignal;
}

export interface ChunkContext extends AnalysisContext {
  chunkIndex: number;
  chunkCount: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface AIAnalysisService {
  readonly provider: string;
  readonly model: string;

  /** Single-pass analysis of a whole (small) conversation. */
  analyzeConversation(
    excerpts: Excerpt[],
    context: AnalysisContext,
  ): Promise<Analysis>;

  /** Map phase: analyse one slice of a large conversation. */
  analyzeCommunicationPatterns(
    excerpts: Excerpt[],
    context: ChunkContext,
  ): Promise<ChunkFindings>;

  /** Reduce phase: turn chunk findings plus statistics into the final report. */
  generateFinalSummary(
    findings: ChunkFindings[],
    context: AnalysisContext,
  ): Promise<Analysis>;

  /** Token usage accumulated across every call made by this instance. */
  usage(): UsageTotals;
}

/** Everything the pipeline needs, independent of transport. */
export interface PipelineInput extends AnalysisRequest {
  service: AIAnalysisService;
  signal?: AbortSignal;
}
