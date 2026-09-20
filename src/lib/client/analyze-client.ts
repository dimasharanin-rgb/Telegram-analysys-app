/**
 * Client for POST /api/analyze.
 *
 * Reads the Server-Sent Events stream so the progress UI reflects the real
 * pipeline rather than a timer, and surfaces the final result or a
 * user-facing error.
 */

import type { UserFacingError } from "@/lib/errors";
import type { Analysis, AnalysisRequest } from "@/lib/ai/schema";
import { analysisSchema } from "@/lib/ai/schema";
import type { ProgressEvent } from "@/lib/pipeline/run";

export interface AnalysisOutcome {
  analysis: Analysis;
  strategy: string;
  chunks: number;
  provider: string;
  model: string;
}

export class AnalysisError extends Error {
  readonly userFacing: UserFacingError;
  constructor(userFacing: UserFacingError) {
    super(userFacing.message);
    this.name = "AnalysisError";
    this.userFacing = userFacing;
  }
}

const GENERIC: UserFacingError = {
  code: "UNKNOWN",
  message: "The analysis could not be completed.",
  hint: "Try again. If it keeps happening, re-import the conversation.",
  retryable: true,
};

function isUserFacingError(value: unknown): value is UserFacingError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { message?: unknown }).message === "string" &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

export async function requestAnalysis(
  request: AnalysisRequest,
  options: {
    onProgress?: (event: ProgressEvent) => void;
    signal?: AbortSignal;
  } = {},
): Promise<AnalysisOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AnalysisError({
      code: "NETWORK",
      message: "Couldn't reach the analysis service.",
      hint: "Check your connection and try again.",
      retryable: true,
    });
  }

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON error body; fall through to the generic message.
    }
    const error = (body as { error?: unknown } | null)?.error;
    throw new AnalysisError(isUserFacingError(error) ? error : GENERIC);
  }

  if (!response.body) throw new AnalysisError(GENERIC);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: AnalysisOutcome | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const handled = handleFrame(frame, options.onProgress);
        if (handled) outcome = handled;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!outcome) {
    throw new AnalysisError({
      code: "NETWORK",
      message: "The analysis stopped before it finished.",
      hint: "This is usually a dropped connection. Try again.",
      retryable: true,
    });
  }

  return outcome;
}

function handleFrame(
  frame: string,
  onProgress?: (event: ProgressEvent) => void,
): AnalysisOutcome | null {
  const line = frame
    .split("\n")
    .find((candidate) => candidate.startsWith("data:"));
  if (!line) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(5).trim());
  } catch {
    return null;
  }

  const payload = parsed as { type?: string; data?: unknown };

  if (payload.type === "progress") {
    onProgress?.(payload.data as ProgressEvent);
    return null;
  }

  if (payload.type === "error") {
    const error = payload.data;
    throw new AnalysisError(isUserFacingError(error) ? error : GENERIC);
  }

  if (payload.type === "result") {
    const data = payload.data as {
      analysis?: unknown;
      strategy?: string;
      chunks?: number;
      provider?: string;
      model?: string;
    };
    // The server already validated this; re-validating here means a bad
    // response can never be rendered, whatever produced it.
    const result = analysisSchema.safeParse(data.analysis);
    if (!result.success) {
      throw new AnalysisError({
        code: "AI_INVALID_RESPONSE",
        message: "The analysis came back in a shape we couldn't verify.",
        retryable: true,
      });
    }
    return {
      analysis: result.data,
      strategy: data.strategy ?? "single-pass",
      chunks: data.chunks ?? 1,
      provider: data.provider ?? "anthropic",
      model: data.model ?? "unknown",
    };
  }

  return null;
}
