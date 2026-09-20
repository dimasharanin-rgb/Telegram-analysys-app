/**
 * Analysis job service.
 *
 * This is where the two gates live. A job cannot reach PROCESSING unless
 *   1. every participant whose consent is required has given it, and
 *   2. an entitlement credit has actually been spent for it.
 *
 * Both are re-checked at the moment of running, not only at creation, because
 * consent can be withdrawn and credits can be spent elsewhere in between.
 */

import { isActive, type JobStage } from "@/lib/analysis/job";
import { batchModules } from "@/lib/analysis/modules";
import { allowedModulesFor, getProduct } from "@/lib/billing/products";
import { serverConfig } from "@/lib/config";
import { AppError, asAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import {
  analysisJobInputSchema,
  type AnalysisJobInput,
} from "@/lib/ai/modules/input";
import type { AIAnalysisService } from "@/lib/ai/types";
import {
  costMicros,
  runModularAnalysis,
  type AnalysisResultV2,
  type ModularProgressEvent,
} from "@/lib/pipeline/modular";
import { estimateRequestCount } from "@/lib/analysis/modules";
import {
  checkEntitlement,
  releaseEntitlement,
  reserveEntitlement,
} from "@/server/billing/entitlements";
import { evaluateConsentGate } from "@/server/consent/gate";
import { appendAudit } from "@/server/repositories/consent";
import { getConversation } from "@/server/repositories/conversations";
import * as jobs from "@/server/repositories/jobs";
import type { AnalysisJobRecord } from "@/server/repositories/jobs";

/**
 * Jobs currently executing in this process. SQLite plus a single Node process
 * means this is enough to stop a double-click starting two runs; a multi-node
 * deployment would move the claim into the status transition itself.
 */
const running = new Set<string>();

/* -------------------------------------------------------------------------
 * Creation
 * ---------------------------------------------------------------------- */

export interface CreateJobRequest {
  ownerId: string;
  conversationId: string;
  productId: string;
  modules: string[];
  input: unknown;
}

export interface CreatedJob {
  job: AnalysisJobRecord;
  gate: ReturnType<typeof evaluateConsentGate>;
}

export function createAnalysisJob(request: CreateJobRequest): CreatedJob {
  const conversation = getConversation(request.conversationId, request.ownerId);
  if (!conversation) throw new AppError("NOT_FOUND");

  const product = getProduct(request.productId);
  if (!product) throw new AppError("PRODUCT_UNAVAILABLE", { detail: request.productId });
  if (!product.available) {
    throw new AppError("PRODUCT_UNAVAILABLE", {
      message: product.unavailableReason ?? "That option isn't available yet.",
    });
  }

  if (conversation.messageCount > product.maxMessages) {
    throw new AppError("CONVERSATION_TOO_LARGE", {
      message: `${product.name} covers up to ${product.maxMessages.toLocaleString("en-US")} messages; this conversation has ${conversation.messageCount.toLocaleString("en-US")}.`,
    });
  }

  const parsed = analysisJobInputSchema.safeParse(request.input);
  if (!parsed.success) {
    log.warn("job.invalid_input", {
      issue: parsed.error.issues[0]?.path.join(".") ?? "unknown",
    });
    throw new AppError("INVALID_REQUEST");
  }

  // The product decides what may run, not the request.
  const modules = allowedModulesFor(product, request.modules);
  if (modules.length === 0) throw new AppError("INVALID_REQUEST", { detail: "no modules" });

  const excerptChars = parsed.data.excerpts.reduce(
    (sum, excerpt) =>
      sum + excerpt.messages.reduce((inner, message) => inner + message.t.length, 0),
    0,
  );

  const estimatedCalls = estimateRequestCount(modules);
  const pricing = serverConfig().anthropic.pricing;
  // Rough, and only ever used internally: the shared context once, plus a
  // small task prompt and a bounded response per call.
  const estimated = Math.round(
    excerptChars * 0.3 * pricing.inputPerMTok +
      estimatedCalls * 1_500 * pricing.outputPerMTok,
  );

  const gate = evaluateConsentGate(request.conversationId);

  const job = jobs.createJob({
    ownerId: request.ownerId,
    conversationId: request.conversationId,
    productId: product.id,
    analysisType: product.analysisType,
    modules,
    contentTypes: product.contentTypes,
    depth: product.depth,
    status: "CREATED",
    inputMessageCount: conversation.messageCount,
    inputExcerptChars: excerptChars,
    estimatedCostMicros: estimated,
  });

  jobs.saveJobInput(job.id, { ...parsed.data, modules });

  log.info("job.created", {
    jobId: job.id,
    productId: product.id,
    modules: modules.join(","),
    batchModules: batchModules(modules).length,
  });

  return { job: settleStatus(job.id, request.ownerId), gate };
}

/* -------------------------------------------------------------------------
 * Gate evaluation
 * ---------------------------------------------------------------------- */

export interface JobReadiness {
  job: AnalysisJobRecord;
  gate: ReturnType<typeof evaluateConsentGate>;
  entitlementReady: boolean;
  runnable: boolean;
}

/**
 * Recomputes what a job is waiting for and moves it to the matching status.
 * Called on creation and on every status read, so a consent decision made in
 * another browser is reflected without a background worker.
 */
export function settleStatus(jobId: string, ownerId: string): AnalysisJobRecord {
  const job = jobs.getJob(jobId, ownerId);
  if (!job) throw new AppError("NOT_FOUND");
  if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
    return job;
  }
  if (job.status === "PROCESSING") return job;

  const gate = evaluateConsentGate(job.conversationId);

  if (!gate.satisfied) {
    return job.status === "WAITING_FOR_CONSENT"
      ? job
      : jobs.transitionJob(jobId, "WAITING_FOR_CONSENT");
  }

  // Consent is in place. The entitlement is only *checked* here, never spent:
  // reserving a credit before the user asks to run would charge them for an
  // analysis they have not started.
  if (job.entitlementId === null && !checkEntitlement(job.ownerId, job.productId).ok) {
    return job.status === "WAITING_FOR_PAYMENT"
      ? job
      : jobs.transitionJob(jobId, "WAITING_FOR_PAYMENT");
  }

  return job.status === "QUEUED" ? job : jobs.transitionJob(jobId, "QUEUED");
}

export function describeReadiness(jobId: string, ownerId: string): JobReadiness {
  const job = settleStatus(jobId, ownerId);
  const gate = evaluateConsentGate(job.conversationId);
  const entitlementReady =
    job.entitlementId !== null || checkEntitlement(ownerId, job.productId).ok;

  return {
    job,
    gate,
    entitlementReady,
    runnable:
      gate.satisfied &&
      entitlementReady &&
      !isActive(job.status) &&
      job.status !== "COMPLETED",
  };
}

/* -------------------------------------------------------------------------
 * Running
 * ---------------------------------------------------------------------- */

export interface RunJobOptions {
  jobId: string;
  ownerId: string;
  service: AIAnalysisService;
  onProgress?: (event: ModularProgressEvent) => void;
  signal?: AbortSignal;
}

export interface RunJobResult {
  job: AnalysisJobRecord;
  result: AnalysisResultV2;
}

export async function runAnalysisJob(options: RunJobOptions): Promise<RunJobResult> {
  const { jobId, ownerId, service } = options;

  if (running.has(jobId)) throw new AppError("JOB_LOCKED");

  let job = jobs.getJob(jobId, ownerId);
  if (!job) throw new AppError("NOT_FOUND");
  if (job.status === "COMPLETED") throw new AppError("JOB_LOCKED", {
    message: "This analysis has already been produced.",
    hint: "Open it from your analyses instead of running it again.",
  });
  if (isActive(job.status) && job.status === "PROCESSING") throw new AppError("JOB_LOCKED");

  // 1. Consent, re-checked now rather than trusted from creation time.
  const gate = evaluateConsentGate(job.conversationId);
  if (!gate.satisfied) {
    for (const requirement of gate.requirements) {
      if (requirement.consentRequestId && !requirement.satisfied) {
        appendAudit(requirement.consentRequestId, "ANALYSIS_BLOCKED", "system", {
          jobId,
        });
      }
    }
    if (job.status !== "WAITING_FOR_CONSENT") {
      job = jobs.transitionJob(jobId, "WAITING_FOR_CONSENT");
    }
    throw gate.declined ? new AppError("CONSENT_DECLINED") : new AppError("CONSENT_REQUIRED");
  }

  // 2. Entitlement. A credit is spent here and handed back if nothing is
  //    produced, so a failed run does not cost the user an analysis.
  let entitlementId = job.entitlementId;
  if (!entitlementId) {
    try {
      entitlementId = reserveEntitlement(ownerId, job.productId).id;
    } catch (error) {
      if (job.status !== "WAITING_FOR_PAYMENT") {
        jobs.transitionJob(jobId, "WAITING_FOR_PAYMENT");
      }
      throw asAppError(error);
    }
  }

  const input = jobs.getJobInput(jobId);
  if (!input || input.pruned) {
    releaseEntitlement(entitlementId);
    throw new AppError("NOT_FOUND", {
      message: "The prepared conversation data for this analysis is no longer available.",
      hint: "Re-import the conversation and start a new analysis.",
    });
  }

  if (job.status !== "QUEUED") job = jobs.transitionJob(jobId, "QUEUED", { entitlementId });
  job = jobs.transitionJob(jobId, "PROCESSING", { entitlementId, model: service.model });
  running.add(jobId);

  // Record consent that the analysis actually started, against each request.
  for (const requirement of gate.requirements) {
    if (requirement.consentRequestId && requirement.required) {
      appendAudit(requirement.consentRequestId, "ANALYSIS_STARTED", "system", { jobId });
    }
  }

  service.onUsage((event) => {
    jobs.recordUsage({
      jobId,
      ownerId,
      module: event.module,
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      costMicros: costMicros(event),
    });
  });

  try {
    const { result } = await runModularAnalysis({
      input: input.payload as AnalysisJobInput,
      service,
      ...(options.signal ? { signal: options.signal } : {}),
      onProgress: (event) => {
        jobs.updateProgress(jobId, event.stage as JobStage, event.message, event.percent);
        options.onProgress?.(event);
      },
    });

    jobs.saveJobResult(jobId, result);
    pruneInputToEvidence(jobId, input.payload as AnalysisJobInput, result);
    const completed = jobs.transitionJob(jobId, "COMPLETED");

    log.info("job.completed", {
      jobId,
      modules: completed.modules.join(","),
      requests: completed.requestCount,
      inputTokens: completed.inputTokens,
      outputTokens: completed.outputTokens,
      costMicros: completed.actualCostMicros,
    });

    return { job: completed, result };
  } catch (error) {
    const appError = asAppError(error);
    releaseEntitlement(entitlementId);
    jobs.transitionJob(jobId, "FAILED", { errorCode: appError.code });
    log.error("job.failed", { jobId, code: appError.code });
    throw appError;
  } finally {
    running.delete(jobId);
  }
}

/* -------------------------------------------------------------------------
 * Retention
 * ---------------------------------------------------------------------- */

/**
 * Drops every stored exchange the finished analysis did not quote from.
 *
 * Whole exchanges are kept rather than isolated lines, because a quote with no
 * surrounding turn is not readable evidence - and the evidence drawer, the
 * conflict view and the advice tools all read from what survives here. Every
 * other exchange is deleted, which is what makes the retention section of the
 * consent document true.
 */
export function pruneInputToEvidence(
  jobId: string,
  input: AnalysisJobInput,
  result: AnalysisResultV2,
): void {
  const cited = new Set<string>();
  const collect = (evidence: { messageIds: string[] }[] | undefined) => {
    for (const entry of evidence ?? []) {
      for (const id of entry.messageIds) cited.add(id);
    }
  };

  for (const pattern of result.base.patterns) collect(pattern.evidence);
  for (const item of result.base.strengths) collect(item.evidence);
  for (const item of result.base.watchouts) collect(item.evidence);
  for (const item of result.interaction?.patterns ?? []) collect(item.evidence);
  for (const item of result.emotional?.observations ?? []) collect(item.evidence);
  for (const item of result.conflicts?.conflicts ?? []) collect(item.evidence);
  for (const item of result.timeline?.changes ?? []) collect(item.evidence);
  for (const item of result.profiles?.profiles ?? []) collect(item.evidence);

  const reduced: AnalysisJobInput = {
    ...input,
    excerpts: input.excerpts.filter((excerpt) =>
      excerpt.messages.some((message) => cited.has(message.id)),
    ),
  };

  jobs.pruneJobInput(jobId, reduced);

  const before = input.excerpts.reduce((sum, e) => sum + e.messages.length, 0);
  const after = reduced.excerpts.reduce((sum, e) => sum + e.messages.length, 0);
  log.info("job.input_pruned", { jobId, before, after });
}

export function cancelJob(jobId: string, ownerId: string): AnalysisJobRecord {
  const job = jobs.getJob(jobId, ownerId);
  if (!job) throw new AppError("NOT_FOUND");
  if (job.entitlementId) releaseEntitlement(job.entitlementId);
  return jobs.transitionJob(jobId, "CANCELLED");
}
