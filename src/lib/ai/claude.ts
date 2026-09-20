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
  UsageTotals,
} from "./types";

interface CallOptions<T> {
  system: string;
  userMessage: string;
  schema: z.ZodType<T>;
  effort: EffortLevel;
  signal?: AbortSignal;
  stage: string;
}

export class ClaudeAnalysisService implements AIAnalysisService {
  readonly provider = "anthropic";
  readonly model: string;

  private readonly client: Anthropic;
  private readonly totals: UsageTotals = { inputTokens: 0, outputTokens: 0, calls: 0 };

  constructor(client?: Anthropic) {
    const config = serverConfig();
    if (!config.anthropic.apiKey && !client) {
      throw new AppError("NOT_CONFIGURED", {
        detail: "ANTHROPIC_API_KEY is not set",
      });
    }
    this.model = config.anthropic.model;
    this.client =
      client ??
      new Anthropic({
        apiKey: config.anthropic.apiKey,
        timeout: config.anthropic.timeoutMs,
        maxRetries: config.anthropic.maxRetries,
      });
  }

  usage(): UsageTotals {
    return { ...this.totals };
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
      effort: serverConfig().anthropic.synthesisEffort,
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
      effort: serverConfig().anthropic.effort,
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
      effort: serverConfig().anthropic.synthesisEffort,
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

    const userContent = previousProblem
      ? `${options.userMessage}\n\n${repairInstruction(previousProblem)}`
      : options.userMessage;

    let response;
    try {
      response = await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: config.anthropic.maxOutputTokens,
          system: options.system,
          thinking: { type: "adaptive", display: "omitted" },
          output_config: {
            effort: options.effort,
            format: zodOutputFormat(options.schema),
          },
          messages: [{ role: "user", content: userContent }],
        },
        options.signal ? { signal: options.signal } : undefined,
      );
    } catch (error) {
      throw translateProviderError(error);
    }

    this.totals.calls += 1;
    this.totals.inputTokens += response.usage?.input_tokens ?? 0;
    this.totals.outputTokens += response.usage?.output_tokens ?? 0;

    log.debug("ai.call", {
      stage: options.stage,
      model: this.model,
      effort: options.effort,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
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
