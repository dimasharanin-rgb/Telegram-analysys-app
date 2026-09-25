/**
 * Provider-agnostic analysis service.
 *
 * The pipeline depends on this interface only. `ClaudeAnalysisService` is the
 * one implementation today; adding another provider means adding a class here,
 * not touching the pipeline or the routes.
 */

import type { z } from "zod";

import type { EffortLevel } from "@/lib/config";
import type { AiTask, ModelTier } from "./routing";
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

/**
 * One model call, reported as it happens.
 *
 * Wide enough to answer the questions that decide whether routing is working:
 * which tier ran, what it cost, how long it took, whether the cache was hit
 * and whether the call had to be escalated or repaired. None of this is ever
 * shown to a user - it exists so the routing table can be tuned against real
 * traffic rather than guesses.
 */
export interface UsageEvent {
  /** Free-form stage label, e.g. `chunk_3` or a module id. */
  module: string;
  task: AiTask;
  tier: ModelTier;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Micro-dollars, priced at the tier that actually ran. */
  costMicros: number;
  latencyMs: number;
  retries: number;
  cached: boolean;
  escalated: boolean;
  ok: boolean;
}

export interface ModuleRunOptions<T> {
  /** Names the module in usage records and logs. */
  moduleId: string;
  /**
   * Decides which model runs this module. Named `aiTask` because `task` below
   * is the prompt instruction, and the two are very different things.
   */
  aiTask: AiTask;
  /** Raises the module above its default tier, for selective escalation. */
  tier?: ModelTier;
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
