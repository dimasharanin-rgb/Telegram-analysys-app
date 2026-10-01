import Anthropic from "@anthropic-ai/sdk";
import type { AnalystResult, TradeAnalyst } from "./analyst";
import { AiError } from "./errors";
import { parseClaudeResponse } from "./parse";
import type { ClaudePayload } from "./payload";
import { AI_OUTPUT_JSON_SCHEMA } from "./schema";
import { getSystemPrompt } from "./systemPrompt";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeAnalystOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  effort: Effort;
  /** Override the HTTP client (tests). */
  fetch?: typeof fetch;
}

/**
 * Claude as the analytical layer. It receives structured data only and must
 * answer in the strict output schema; it has no say over the account rules,
 * which were enforced before this is ever called.
 */
export class ClaudeAnalyst implements TradeAnalyst {
  readonly provider = "anthropic" as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: Effort;

  constructor(options: ClaudeAnalystOptions) {
    this.model = options.model;
    this.effort = options.effort;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs,
      maxRetries: 1,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async analyze(payload: ClaudePayload): Promise<AnalystResult> {
    const started = Date.now();
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        // If a safety classifier declines, let the API re-run the request on its recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: getSystemPrompt(),
        messages: [
          {
            role: "user",
            content: `Evaluate this proposed trade setup. Input data:\n\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
        output_config: {
          effort: this.effort,
          format: { type: "json_schema", schema: AI_OUTPUT_JSON_SCHEMA },
        },
      });
    } catch (error) {
      throw toAiError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new AiError("REFUSAL", "The model declined to assess this request.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new AiError("TRUNCATED", "The model's answer was cut off before it was complete.");
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = parseClaudeResponse(text);

    return {
      assessment: parsed.assessment,
      info: {
        provider: "anthropic",
        model: this.model,
        servedBy: response.model,
        durationMs: Date.now() - started,
        notes: response.model !== this.model
          ? [...parsed.notes, `Answered by fallback model ${response.model}.`]
          : parsed.notes,
      },
    };
  }
}

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError("TIMEOUT", "Claude did not respond in time.");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError("CONNECTION", "Could not reach the Anthropic API.");
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiError("AUTHENTICATION", "The Anthropic API key was rejected.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError("RATE_LIMITED", "The Anthropic API rate limit was reached. Try again shortly.");
  }
  if (error instanceof Anthropic.APIError) {
    return new AiError("API_ERROR", `Anthropic API error${error.status ? ` ${error.status}` : ""}.`);
  }
  return new AiError("API_ERROR", "Unexpected error while calling Claude.");
}
