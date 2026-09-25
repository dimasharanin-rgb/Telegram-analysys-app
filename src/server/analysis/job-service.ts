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

import { isTerminal, type JobStage } from "@/lib/analysis/job";
import { batchModules } from "@/lib/analysis/modules";
import { allowedModulesFor, getProduct } from "@/lib/billing/products";
import { serverConfig } from "@/lib/config";
import { AppError, asAppError } from "@/lib/errors";
import type { DeclaredAttachment } from "@/lib/api/schemas";
import { enrichExcerpts } from "@/lib/ai/media-context";
import type { AttachmentAnalyser } from "@/lib/ai/claude";
import { processJobMedia } from "@/server/media/process";
import { summariseMedia } from "./process-media-summary";
import {
  cacheKeyFor,
  digestExcerpts,
  digestMedia,
  findCachedResult,
  storeCachedResult,
} from "./cache";
import { sizeTierFor } from "@/lib/analysis/size-tiers";
import type { Excerpt } from "@/lib/ai/schema";
import { planMedia } from "@/server/repositories/media";
import {
  planMediaFor,
  readMessageIdsFrom,
  scopeFromContentTypes,
} from "@/server/media/plan";
import type { MediaUsage } from "@/lib/media/policy";
import { log } from "@/lib/logger";
import {
  analysisJobInputSchema,
  type AnalysisJobInput,
} from "@/lib/ai/modules/input";
import type { AIAnalysisService } from "@/lib/ai/types";
import {

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
  /** What media the export contains. Metadata only; no bytes. */
  media?: readonly DeclaredAttachment[];
}

export interface CreatedJob {
  job: AnalysisJobRecord;
  gate: ReturnType<typeof evaluateConsentGate>;
  /**
   * The files the analysis wants, if any. The client uploads exactly these and
   * nothing else - an export's remaining photographs never leave the machine.
   */
  mediaRequests: { reference: string }[];
  /** What processing those files is estimated to cost. Nothing is billed from it. */
  mediaUsage: MediaUsage;
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

  // Deliberately no size rejection. What a product buys is how much of the
  // conversation gets read, and the excerpts were already budgeted to that
  // before they were sent - so a large conversation produces a partial
  // analysis that says it is partial, rather than an error.

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

  // The media plan is built from what the client declared and what the product
  // allows, and is recorded before any bytes exist. Each row is the permission
  // to upload one file; anything else offered later is refused.
  const plan = planMediaFor({
    declared: request.media ?? [],
    readMessageIds: readMessageIdsFrom(parsed.data.excerpts),
    productId: product.id,
    scope: scopeFromContentTypes(product.contentTypes),
  });
  if (plan.wanted.length > 0) {
    planMedia(job.id, request.ownerId, plan.wanted);
  }

  log.info("job.created", {
    jobId: job.id,
    productId: product.id,
    modules: modules.join(","),
    batchModules: batchModules(modules).length,
    mediaDeclared: request.media?.length ?? 0,
    mediaWanted: plan.wanted.length,
    mediaCostMicros: plan.usage.estimatedCostMicros,
    mediaSkippedOutOfScope: plan.skipped.outOfScope,
    mediaSkippedOutsideWindow: plan.skipped.outsideReadWindow,
  });

  return {
    job: settleStatus(job.id, request.ownerId),
    gate,
    mediaRequests: plan.wanted.map((asset) => ({ reference: asset.reference })),
    mediaUsage: plan.usage,
  };
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
    // QUEUED is precisely the runnable state: both gates are satisfied and
    // nothing is in flight. Only a run already under way, or a job that has
    // finished one way or another, is out of reach.
    runnable:
      gate.satisfied &&
      entitlementReady &&
      job.status !== "PROCESSING" &&
      !isTerminal(job.status),
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
  /**
   * Skip the cache and run the analysis again.
   *
   * The one thing the cache key cannot express: "I have read this and I want
   * another go at it". Everything else that should invalidate a result is in
   * the key, so this exists only for a deliberate request.
   */
  regenerate?: boolean;
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
  if (job.status === "PROCESSING") throw new AppError("JOB_LOCKED");

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
      // Priced at the tier that ran, which is the whole point of routing -
      // the flat estimate would report a cheap call as costing Opus money.
      costMicros: event.costMicros,
      task: event.task,
      tier: event.tier,
      provider: event.provider,
      cachedInputTokens: event.cachedInputTokens,
      latencyMs: event.latencyMs,
      retries: event.retries,
      cached: event.cached,
      escalated: event.escalated,
      ok: event.ok,
      mediaKind: mediaKindForTask(event.task),
    });
  });

  try {
    const payload = input.payload as AnalysisJobInput;

    // 3. Media, before the analysis rather than alongside it.
    //
    //    Sequential on purpose: a transcript and a screenshot's text are part of
    //    what the conversation said, so the analysis has to read them in the
    //    same pass as the words around them. Running the two concurrently would
    //    mean analysing a voice note as "a voice note" and then never revisiting
    //    it. The stage also deletes the uploaded bytes when it finishes.
    jobs.updateProgress(jobId, "preparing", "Reading attachments…", 5);
    const mediaOutcome = await processJobMedia({
      jobId,
      ownerId,
      productId: job.productId,
      textById: textFromExcerpts(payload.excerpts),
      orderedIds: orderedIdsFromExcerpts(payload.excerpts),
      // Only what every required participant agreed to. An intersection, so one
      // person's broad consent cannot authorise reading another's photographs.
      consented: {
        images: gate.consentedDataTypes.includes("IMAGES"),
        audio: gate.consentedDataTypes.includes("AUDIO"),
      },
      analyser: asAttachmentAnalyser(service),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const enriched = enrichExcerpts(payload.excerpts, mediaOutcome);

    // 4. Has this exact analysis already been produced?
    //
    //    Checked after media rather than before, because a transcript changes
    //    what the model reads and therefore what the answer should be - a key
    //    computed before transcription would collide with the run that had none.
    const cacheKey = cacheKeyFor({
      conversationDigest: digestExcerpts(enriched),
      productId: job.productId,
      modules: job.modules,
      language: payload.language ?? "en",
      mediaDigest: digestMedia(mediaOutcome.media, mediaOutcome.transcripts),
      sizeTierId: sizeTierFor(job.productId).id,
    });

    const cached =
      options.regenerate === true ? null : findCachedResult(cacheKey, ownerId);

    if (cached !== null) {
      jobs.saveJobResult(jobId, cached);
      pruneInputToEvidence(jobId, payload, cached);
      const reused = jobs.transitionJob(jobId, "COMPLETED");
      // The credit is handed back: nothing was spent producing this.
      releaseEntitlement(entitlementId);
      running.delete(jobId);
      log.info("job.completed_from_cache", { jobId });
      return { job: reused, result: cached };
    }

    const mediaSummary = summariseMedia(mediaOutcome, {
      timeById: timeFromExcerpts(payload.excerpts),
      participantById: participantFromExcerpts(payload.excerpts),
    });

    const { result } = await runModularAnalysis({
      input: {
        ...payload,
        excerpts: enriched,
      },
      service,
      ...(options.signal ? { signal: options.signal } : {}),
      onProgress: (event) => {
        jobs.updateProgress(jobId, event.stage as JobStage, event.message, event.percent);
        options.onProgress?.(event);
      },
    });

    // The media section is attached here rather than inside the pipeline,
    // because the pipeline never sees an attachment and should not have to
    // pretend otherwise.
    const withMedia = { ...result, media: mediaSummary };

    jobs.saveJobResult(jobId, withMedia);
    storeCachedResult(cacheKey, ownerId, jobId, withMedia);
    pruneInputToEvidence(jobId, payload, withMedia);
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
    log.error("job.failed", { jobId, code: appError.code, detail: appError.message });
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

/* -------------------------------------------------------------------------
 * Media helpers
 * ---------------------------------------------------------------------- */

/**
 * Message text the analysis will read, keyed by id.
 *
 * Built from the excerpts rather than the conversation because the excerpts are
 * what the model sees, and relevance should be judged on the same text.
 */
function textFromExcerpts(excerpts: readonly Excerpt[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const excerpt of excerpts) {
    for (const message of excerpt.messages) out.set(message.id, message.t);
  }
  return out;
}

/** Those ids in conversation order, for reading a message's neighbours. */
function orderedIdsFromExcerpts(excerpts: readonly Excerpt[]): string[] {
  const ids: string[] = [];
  for (const excerpt of excerpts) {
    for (const message of excerpt.messages) ids.push(message.id);
  }
  return ids;
}

/**
 * The analysis service, if it can also take attachments.
 *
 * `AIAnalysisService` deliberately does not require attachment support - a text
 * stub should not have to implement image handling to be a valid service - so
 * this narrows at runtime instead. A service without it means no image is
 * described, which the gateway already treats as a reason to withhold.
 */
function asAttachmentAnalyser(service: AIAnalysisService): AttachmentAnalyser | null {
  const candidate = service as Partial<AttachmentAnalyser>;
  return typeof candidate.runAttachmentTask === "function"
    ? (service as unknown as AttachmentAnalyser)
    : null;
}

/**
 * Which media kind a task's input was, if any.
 *
 * Lets media cost be separated from text cost in the usage table without the
 * call site having to know, and without a second column the routing layer would
 * have to remember to populate.
 */
function mediaKindForTask(task: string): string | null {
  if (task.startsWith("IMAGE_")) return "image";
  if (task.startsWith("SCREENSHOT")) return "image";
  if (task.startsWith("DOCUMENT_")) return "document";
  return null;
}

/** Wall-clock time per message id, from the excerpts' own start times. */
function timeFromExcerpts(excerpts: readonly Excerpt[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const excerpt of excerpts) {
    for (const message of excerpt.messages) {
      // The excerpt records minutes from its own start, which is enough to
      // place an attachment without carrying absolute timestamps per message.
      const at = new Date(
        new Date(excerpt.startIso).getTime() + message.m * 60_000,
      ).toISOString();
      out.set(message.id, at);
    }
  }
  return out;
}

/** Pseudonymous participant label per message id. */
function participantFromExcerpts(excerpts: readonly Excerpt[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const excerpt of excerpts) {
    for (const message of excerpt.messages) out.set(message.id, message.p);
  }
  return out;
}
