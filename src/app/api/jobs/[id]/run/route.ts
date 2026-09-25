/**
 * POST /api/jobs/:id/run — run a prepared analysis, streaming progress.
 *
 * Both gates are checked inside the job service, at the moment of running.
 * This route's job is transport: resolve the owner, build the provider client,
 * and turn pipeline progress into Server-Sent Events.
 */

import { ClaudeAnalysisService } from "@/lib/ai/claude";
import { AppError, asAppError } from "@/lib/errors";
import type { ModularProgressEvent } from "@/lib/pipeline/modular";
import { runAnalysisJob } from "@/server/analysis/job-service";
import { errorResponse, withOwner } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

type Frame =
  | { type: "progress"; data: ModularProgressEvent }
  | { type: "result"; data: { jobId: string; status: string } }
  | { type: "error"; data: ReturnType<AppError["toUserFacing"]> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;

  // An explicit ask for a fresh run. A query parameter rather than a body
  // because the request is a stream and the body is not read otherwise.
  const regenerate = new URL(request.url).searchParams.get("regenerate") === "1";

  return withOwner(
    async ({ ownerId }) => {
      let service: ClaudeAnalysisService;
      try {
        service = new ClaudeAnalysisService();
      } catch (error) {
        return errorResponse(error);
      }

      const encoder = new TextEncoder();
      const controller = new AbortController();
      request.signal.addEventListener("abort", () => controller.abort());

      const stream = new ReadableStream<Uint8Array>({
        async start(streamController) {
          const send = (frame: Frame) => {
            try {
              streamController.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
            } catch {
              // The client disconnected; the abort handler stops the run.
            }
          };

          try {
            const { job } = await runAnalysisJob({
              jobId: id,
              ownerId,
              service,
              signal: controller.signal,
              regenerate,
              onProgress: (event) => send({ type: "progress", data: event }),
            });
            send({ type: "result", data: { jobId: job.id, status: job.status } });
          } catch (error) {
            send({ type: "error", data: asAppError(error).toUserFacing() });
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
    },
    { create: false, rateLimit: true },
  )(request);
}
