/**
 * Anthropic Claude implementation of `AIAnalysisService`.
 *
 * This is the only file in the application that knows the Anthropic SDK
 * exists. It owns three things:
 *   - turning our prompts into requests with the configured model/effort,
 *   - forcing structured output and validating it against our Zod schemas,
 *   - translating provider failures into the app's error taxonomy.
 *
 * Model output is treated as untrusted. Structured outputs make malformed JSON
 * unlikely, not impossible, so a failed parse triggers one repair attempt with
 * the validation problem fed back to the model before the call is given up on.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import { serverConfig, type EffortLevel } from "@/lib/config";
import {
  costMicrosForTier,
  routeTask,
  type AiTask,
  type ModelTier,
} from "./routing";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import {
  analysisSchema,
  chunkFindingsSchema,
  type Analysis,
  type ChunkFindings,
  type Excerpt,
} from "./schema";
import {
  buildChunkMessage,
  buildSinglePassMessage,
  buildSynthesisMessage,
  repairInstruction,
  systemPromptChunk,
  systemPromptSinglePass,
  systemPromptSynthesis,
} from "./prompts";
import type {
  AIAnalysisService,
  AnalysisContext,
  ChunkContext,
  ModuleRunOptions,
  UsageEvent,
  UsageTotals,
} from "./types";

interface CallOptions<T> {
  /**
   * System prompt. An array is sent as separate blocks with the last one
   * marked cacheable, which is how a job's shared context is paid for once.
   */
  system: string | { text: string; cache: boolean }[];
  userMessage: string;
  schema: z.ZodType<T>;
  /** Decides which model runs this call. Never a model id at a call site. */
  task: AiTask;
  /** Raises the task above its default tier, for escalation. */
  tier?: ModelTier;
  /**
   * Overrides the tier's effort. Used only where a task genuinely needs more
   * thinking than its tier-mates; routing still chooses the model.
   */
  effort?: EffortLevel;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /** Free-form label for logs and per-module accounting, e.g. `chunk_3`. */
  stage: string;
}

export class ClaudeAnalysisService implements AIAnalysisService {
  readonly provider = "anthropic";
  /**
   * The standard-tier model. Reported as "the" model for a job, but no call is
   * obliged to use it - `routeTask` picks per call.
   */
  readonly model: string;

  private readonly client: Anthropic;
  private readonly totals: UsageTotals = { inputTokens: 0, outputTokens: 0, calls: 0 };
  private usageListener: ((event: UsageEvent) => void) | null = null;

  constructor(client?: Anthropic) {
    const config = serverConfig();
    if (!config.anthropic.apiKey && !client) {
      throw new AppError("NOT_CONFIGURED", {
        detail: "ANTHROPIC_API_KEY is not set",
      });
    }
    this.model = config.anthropic.models.standard;
    this.client =
      client ??
      new Anthropic({
        apiKey: config.anthropic.apiKey,
        timeout: config.anthropic.timeoutMs,
        maxRetries: config.anthropic.maxRetries,
        // Set when the deployment reaches Anthropic through a gateway or
        // egress proxy rather than the public endpoint.
        ...(config.anthropic.baseUrl ? { baseURL: config.anthropic.baseUrl } : {}),
      });
  }

  usage(): UsageTotals {
    return { ...this.totals };
  }

  onUsage(listener: (event: UsageEvent) => void): void {
    this.usageListener = listener;
  }

  /**
   * Runs one module. The shared context goes in a cached system block, so the
   * second and later modules of a job re-read it at cache rates instead of
   * resending the whole conversation.
   */
  async runModule<T>(options: ModuleRunOptions<T>): Promise<T> {
    return this.call({
      system: [
        { text: options.systemContext, cache: true },
        { text: options.task, cache: false },
      ],
      userMessage:
        "Produce the analysis for the task described above, using the statistics and excerpts already provided.",
      schema: options.schema,
      task: options.aiTask,
      ...(options.tier ? { tier: options.tier } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      ...(options.maxOutputTokens !== undefined
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      stage: options.moduleId,
    });
  }

  async analyzeConversation(
    excerpts: Excerpt[],
    context: AnalysisContext,
  ): Promise<Analysis> {
    return this.call({
      system: systemPromptSinglePass(),
      userMessage: buildSinglePassMessage(
        excerpts,
        context.statistics,
        context.participants,
      ),
      schema: analysisSchema,
      task: "SYNTHESIS",
      ...(context.signal ? { signal: context.signal } : {}),
      stage: "single_pass",
    });
  }

  async analyzeCommunicationPatterns(
    excerpts: Excerpt[],
    context: ChunkContext,
  ): Promise<ChunkFindings> {
    return this.call({
      system: systemPromptChunk(),
      userMessage: buildChunkMessage(
        excerpts,
        context.participants,
        context.chunkIndex,
        context.chunkCount,
      ),
      schema: chunkFindingsSchema,
      // The map phase reads one slice and reports what is in it. That is
      // extraction, not interpretation, so it runs on the cheap tier and the
      // synthesis below is what actually reasons over the results.
      task: "CHUNK_SUMMARY",
      ...(context.signal ? { signal: context.signal } : {}),
      stage: `chunk_${context.chunkIndex + 1}`,
    });
  }

  async generateFinalSummary(
    findings: ChunkFindings[],
    context: AnalysisContext,
  ): Promise<Analysis> {
    return this.call({
      system: systemPromptSynthesis(),
      userMessage: buildSynthesisMessage(
        findings,
        context.statistics,
        context.participants,
      ),
      schema: analysisSchema,
      task: "SYNTHESIS",
      ...(context.signal ? { signal: context.signal } : {}),
      stage: "synthesis",
    });
  }

  /* ---------------------------------------------------------------------
   * Request plumbing
   * ------------------------------------------------------------------ */

  private async call<T>(options: CallOptions<T>): Promise<T> {
    const first = await this.attempt(options, null);
    if (first.ok) return first.value;

    log.warn("ai.schema_violation", { stage: options.stage, problem: first.problem });

    const repaired = await this.attempt(options, first.problem);
    if (repaired.ok) return repaired.value;

    log.error("ai.schema_violation_final", {
      stage: options.stage,
      problem: repaired.problem,
    });
    throw new AppError("AI_INVALID_RESPONSE", {
      detail: `${options.stage}: ${repaired.problem}`,
    });
  }

  private async attempt<T>(
    options: CallOptions<T>,
    previousProblem: string | null,
  ): Promise<{ ok: true; value: T } | { ok: false; problem: string }> {
    const config = serverConfig();
    const route = routeTask(options.task, options.tier);
    const effort = options.effort ?? route.effort;
    const startedAt = Date.now();

    const userContent = previousProblem
      ? `${options.userMessage}\n\n${repairInstruction(previousProblem)}`
      : options.userMessage;

    let response;
    try {
      response = await this.client.messages.parse(
        {
          model: route.model,
          max_tokens: options.maxOutputTokens ?? config.anthropic.maxOutputTokens,
          system:
            typeof options.system === "string"
              ? options.system
              : options.system.map((block) => ({
                  type: "text" as const,
                  text: block.text,
                  ...(block.cache
                    ? { cache_control: { type: "ephemeral" as const } }
                    : {}),
                })),
          thinking: { type: "adaptive", display: "omitted" },
          output_config: {
            effort,
            format: zodOutputFormat(options.schema),
          },
          messages: [{ role: "user", content: userContent }],
        },
        options.signal ? { signal: options.signal } : undefined,
      );
    } catch (error) {
      // The SDK validates structured output against the schema itself and
      // throws synchronously on a violation - a string over its max length,
      // say - rather than returning it for us to inspect. Left alone, that
      // throw skips the repair retry entirely and kills the whole run on a
      // mistake the model can usually just be asked to fix. Route it into
      // the same ok:false path a validation failure we caught ourselves
      // would take.
      const schemaProblem = describeStructuredOutputFailure(error);
      if (schemaProblem !== null) {
        return { ok: false, problem: schemaProblem };
      }
      throw translateProviderError(error);
    }

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const cachedInputTokens = response.usage?.cache_read_input_tokens ?? 0;

    this.totals.calls += 1;
    this.totals.inputTokens += inputTokens;
    this.totals.outputTokens += outputTokens;

    this.usageListener?.({
      module: options.stage,
      task: options.task,
      tier: route.tier,
      provider: this.provider,
      model: route.model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      costMicros: costMicrosForTier(route.tier, {
        inputTokens,
        outputTokens,
        cachedInputTokens,
      }),
      latencyMs: Date.now() - startedAt,
      // A second attempt only happens after a schema violation, so a repair
      // call is exactly the case where this is 1.
      retries: previousProblem === null ? 0 : 1,
      cached: cachedInputTokens > 0,
      escalated: route.escalated,
      ok: response.stop_reason !== "refusal",
    });

    log.debug("ai.call", {
      stage: options.stage,
      task: options.task,
      tier: route.tier,
      model: route.model,
      effort,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      latencyMs: Date.now() - startedAt,
      stopReason: response.stop_reason ?? "unknown",
    });

    if (response.stop_reason === "refusal") {
      throw new AppError("AI_REFUSED", {
        detail: `refusal at ${options.stage}`,
      });
    }
    if (response.stop_reason === "max_tokens") {
      return {
        ok: false,
        problem: "the response was cut off before it finished; produce a shorter analysis",
      };
    }

    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) {
      // Structured outputs failed to bind - fall back to reading the text
      // blocks and validating whatever JSON is in them.
      const recovered = recoverJson(response.content);
      if (recovered === null) {
        return { ok: false, problem: "no JSON object was present in the response" };
      }
      const result = options.schema.safeParse(recovered);
      if (result.success) return { ok: true, value: result.data };
      return { ok: false, problem: describeIssues(result.error) };
    }

    const result = options.schema.safeParse(parsed);
    if (result.success) return { ok: true, value: result.data };
    return { ok: false, problem: describeIssues(result.error) };
  }
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Recognises the SDK's own "the response didn't match the schema" throw and
 * turns it into the same short problem description `describeIssues` produces,
 * so it can go through the ordinary repair-retry path instead of failing the
 * call outright.
 *
 * The SDK wraps this twice - once in the zod helper, once again in its own
 * response parser - so the useful part (the actual Zod issues) is buried
 * after a "Validation issues:" marker inside a stringified error. A plain
 * JSON-parse failure at the same point carries no such marker; either way,
 * returning null here means "not this - let the normal error path handle it".
 */
function describeStructuredOutputFailure(error: unknown): string | null {
  if (
    !(error instanceof Anthropic.AnthropicError) ||
    error instanceof Anthropic.APIError ||
    !error.message.includes("Failed to parse structured output")
  ) {
    return null;
  }
  const marker = "Validation issues:";
  const at = error.message.lastIndexOf(marker);
  if (at === -1) return "the response was not valid JSON";
  return error.message
    .slice(at + marker.length)
    .trim()
    .replace(/\s*\n\s*/g, "; ");
}

/**
 * Last-resort JSON recovery. Pulls the outermost balanced `{...}` out of the
 * response text, which survives a model wrapping its JSON in prose or a code
 * fence. Anything recovered is still validated against the schema.
 */
export function recoverJson(content: unknown): unknown | null {
  if (!Array.isArray(content)) return null;
  const text = content
    .map((block) =>
      typeof block === "object" && block !== null && "type" in block &&
      (block as { type: unknown }).type === "text"
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .join("");

  if (text.trim().length === 0) return null;

  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Maps SDK exceptions onto the application's error taxonomy. */
export function translateProviderError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof Anthropic.APIUserAbortError) {
    return new AppError("AI_TIMEOUT", { detail: "request aborted" });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new AppError("NOT_CONFIGURED", { detail: "provider rejected the API key" });
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AppError("NOT_CONFIGURED", { detail: "provider denied permission" });
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AppError("NOT_CONFIGURED", {
      detail: "configured model is not available to this account",
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AppError("AI_RATE_LIMITED");
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new AppError("AI_UNAVAILABLE", { detail: `provider ${error.status}` });
  }
  // APIConnectionTimeoutError extends APIConnectionError, so check it first.
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError("AI_TIMEOUT");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AppError("NETWORK");
  }
  if (error instanceof Anthropic.BadRequestError) {
    // Usually a payload that grew past a provider limit.
    return new AppError("TOO_LARGE", {
      detail: "provider rejected the request as invalid",
      message: "This conversation was too large for a single analysis request.",
      hint: "Try exporting a shorter date range.",
    });
  }
  if (error instanceof Anthropic.APIError) {
    return new AppError("AI_UNAVAILABLE", { detail: `provider error ${error.status}` });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new AppError("AI_TIMEOUT", { detail: "request aborted" });
  }
  return new AppError("UNKNOWN", {
    detail: error instanceof Error ? error.message : "provider call failed",
  });
}
