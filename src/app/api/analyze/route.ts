/**
 * POST /api/analyze
 *
 * Accepts the pseudonymised digest + excerpts built in the browser, runs the
 * analysis pipeline, and streams real pipeline progress back as Server-Sent
 * Events, finishing with either a `result` or an `error` frame.
 *
 * The Anthropic key is read here and never leaves the server.
 */

import { serverConfig } from "@/lib/config";
import { AppError, asAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { analysisRequestSchema } from "@/lib/ai/schema";
import { ClaudeAnalysisService } from "@/lib/ai/claude";
import { runAnalysisPipeline, type ProgressEvent } from "@/lib/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Frame =
  | { type: "progress"; data: ProgressEvent }
  | {
      type: "result";
      data: {
        analysis: unknown;
        strategy: string;
        chunks: number;
        provider: string;
        model: string;
      };
    }
  | { type: "error"; data: ReturnType<AppError["toUserFacing"]> };

function sse(frame: Frame): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

export async function POST(request: Request): Promise<Response> {
  const config = serverConfig();

  const limit = checkRateLimit(
    clientKey(request.headers),
    config.limits.rateLimitMaxRequests,
    config.limits.rateLimitWindowMs,
  );
  if (!limit.allowed) {
    return jsonError(new AppError("RATE_LIMITED"), {
      "retry-after": String(limit.retryAfterSeconds),
    });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > config.limits.maxAnalyzeRequestBytes) {
    return jsonError(new AppError("TOO_LARGE"));
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > config.limits.maxAnalyzeRequestBytes) {
      return jsonError(new AppError("TOO_LARGE"));
    }
    body = JSON.parse(text);
  } catch {
    return jsonError(new AppError("INVALID_REQUEST"));
  }

  const parsed = analysisRequestSchema.safeParse(body);
  if (!parsed.success) {
    log.warn("analyze.invalid_request", {
      issue: parsed.error.issues[0]?.path.join(".") ?? "unknown",
    });
    return jsonError(new AppError("INVALID_REQUEST"));
  }

  if (!parsed.data.consent.accepted) {
    return jsonError(new AppError("CONSENT_REQUIRED"));
  }

  let service: ClaudeAnalysisService;
  try {
    service = new ClaudeAnalysisService();
  } catch (error) {
    return jsonError(asAppError(error));
  }

  const encoder = new TextEncoder();
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const send = (frame: Frame) => {
        try {
          streamController.enqueue(encoder.encode(sse(frame)));
        } catch {
          // Client went away mid-stream; the abort handler tears the run down.
        }
      };

      try {
        const result = await runAnalysisPipeline({
          request: parsed.data,
          service,
          signal: controller.signal,
          onProgress: (event) => send({ type: "progress", data: event }),
        });

        send({
          type: "result",
          data: {
            analysis: result.analysis,
            strategy: result.strategy,
            chunks: result.chunks,
            provider: service.provider,
            model: service.model,
          },
        });
      } catch (error) {
        const appError = asAppError(error);
        send({ type: "error", data: appError.toUserFacing() });
      } finally {
        streamController.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function jsonError(error: AppError, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: error.toUserFacing() }), {
    status: error.status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}
