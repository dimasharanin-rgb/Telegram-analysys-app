/**
 * Provider-agnostic analysis service.
 *
 * The pipeline depends on this interface only. `ClaudeAnalysisService` is the
 * one implementation today; adding another provider means adding a class here,
 * not touching the pipeline or the routes.
 */

import type { z } from "zod";

import type { EffortLevel } from "@/lib/config";
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

/** One model call, reported as it happens so a job can bill it to a module. */
export interface UsageEvent {
  module: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface ModuleRunOptions<T> {
  /** Names the module in usage records and logs. */
  moduleId: string;
  /**
   * The cacheable prefix: identical across every module of one job, so the
   * conversation is paid for once rather than once per module.
   */
  systemContext: string;
  /** The task instruction, which is what actually differs per module. */
  task: string;
  schema: z.ZodType<T>;
  effort?: EffortLevel;
  maxOutputTokens?: number;
  signal?: AbortSignal;
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

  /**
   * Runs one analysis module against a shared, cacheable context block.
   * This is the path every V2 module uses.
   */
  runModule<T>(options: ModuleRunOptions<T>): Promise<T>;

  /** Token usage accumulated across every call made by this instance. */
  usage(): UsageTotals;

  /** Receives one event per model call, for per-module cost accounting. */
  onUsage(listener: (event: UsageEvent) => void): void;
}

/** Everything the pipeline needs, independent of transport. */
export interface PipelineInput extends AnalysisRequest {
  service: AIAnalysisService;
  signal?: AbortSignal;
}
