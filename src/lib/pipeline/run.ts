/**
 * Pipeline orchestrator.
 *
 * Telegram export → parser → normalized messages → local statistics →
 * segmentation → excerpts   (all of the above already happened in the browser)
 *   → Claude → structured analysis → validation → UI   (this module)
 *
 * Progress events reflect real stages. A chunked run emits one event per chunk
 * as that chunk's request completes; nothing here invents motion that is not
 * happening.
 */

import { serverConfig } from "@/lib/config";
import { asAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import {
  sanitiseAnalysis,
  type Analysis,
  type AnalysisRequest,
  type ChunkFindings,
  type Excerpt,
} from "@/lib/ai/schema";
import type { AIAnalysisService, UsageTotals } from "@/lib/ai/types";
import { chooseStrategy, type AnalysisStrategy } from "./strategy";

export type PipelineStage =
  | "preparing"
  | "reading"
  | "analyzing"
  | "synthesizing"
  | "validating"
  | "done";

export interface ProgressEvent {
  stage: PipelineStage;
  /** Short sentence shown to the user. */
  message: string;
  /** 0-100. Derived from completed stages, never from a timer. */
  percent: number;
  step?: number;
  totalSteps?: number;
}

export interface PipelineResult {
  analysis: Analysis;
  strategy: "single-pass" | "chunked";
  chunks: number;
  usage: UsageTotals;
  evidenceIds: string[];
}

export interface RunOptions {
  request: AnalysisRequest;
  service: AIAnalysisService;
  onProgress?: (event: ProgressEvent) => void;
  signal?: AbortSignal;
}

function collectIds(excerpts: Excerpt[]): Set<string> {
  const ids = new Set<string>();
  for (const excerpt of excerpts) {
    for (const message of excerpt.messages) ids.add(message.id);
  }
  return ids;
}

export async function runAnalysisPipeline(options: RunOptions): Promise<PipelineResult> {
  const { request, service, signal } = options;
  const config = serverConfig();
  const emit = (event: ProgressEvent) => options.onProgress?.(event);

  emit({
    stage: "preparing",
    message: "Reading conversation…",
    percent: 5,
  });

  const strategy: AnalysisStrategy = chooseStrategy(request.excerpts, {
    totalMessages: request.statistics.totalMessages,
    singlePassMaxMessages: config.pipeline.singlePassMaxMessages,
    excerptCharBudget: config.pipeline.excerptCharBudget,
    maxChunks: config.pipeline.maxChunks,
  });

  const knownIds = collectIds(request.excerpts);
  const context = {
    participants: request.participants.map((p) => ({ id: p.id, label: p.label })),
    statistics: request.statistics,
    ...(signal ? { signal } : {}),
  };

  log.info("pipeline.start", {
    strategy: strategy.kind,
    excerpts: request.excerpts.length,
    messages: request.statistics.totalMessages,
    chunks: strategy.kind === "chunked" ? strategy.chunks.length : 1,
  });

  let analysis: Analysis;
  let chunkCount = 1;

  try {
    if (strategy.kind === "single-pass") {
      emit({
        stage: "analyzing",
        message: "Analyzing communication patterns…",
        percent: 25,
        step: 1,
        totalSteps: 1,
      });
      analysis = await service.analyzeConversation(strategy.excerpts, context);
    } else {
      chunkCount = strategy.chunks.length;
      const findings: ChunkFindings[] = [];

      for (let index = 0; index < strategy.chunks.length; index += 1) {
        signal?.throwIfAborted();
        emit({
          stage: "reading",
          message: `Reading period ${index + 1} of ${chunkCount}…`,
          percent: 10 + Math.round((index / chunkCount) * 55),
          step: index + 1,
          totalSteps: chunkCount,
        });

        const chunk = strategy.chunks[index]!;
        findings.push(
          await service.analyzeCommunicationPatterns(chunk, {
            ...context,
            chunkIndex: index,
            chunkCount,
          }),
        );
      }

      emit({
        stage: "synthesizing",
        message: "Bringing the findings together…",
        percent: 72,
      });
      analysis = await service.generateFinalSummary(findings, context);
    }

    emit({ stage: "validating", message: "Checking the analysis…", percent: 90 });
    const sanitised = sanitiseAnalysis(analysis, knownIds);

    emit({ stage: "done", message: "Preparing your insights…", percent: 100 });

    const usage = service.usage();
    log.info("pipeline.complete", {
      strategy: strategy.kind,
      chunks: chunkCount,
      calls: usage.calls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      patterns: sanitised.patterns.length,
    });

    return {
      analysis: sanitised,
      strategy: strategy.kind,
      chunks: chunkCount,
      usage,
      evidenceIds: [...knownIds],
    };
  } catch (error) {
    const appError = asAppError(error);
    log.error("pipeline.failed", { code: appError.code, strategy: strategy.kind });
    throw appError;
  }
}
