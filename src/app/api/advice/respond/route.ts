/**
 * POST /api/advice/respond — "what could I say?"
 *
 * On demand rather than precomputed: it answers about one moment the user
 * picked. The excerpt comes from their browser, so nothing extra is stored,
 * but the same two gates apply - the job must be theirs and complete, and
 * consent must still be in place, because this sends more conversation text.
 */

import { responseAdviceRequestSchema } from "@/lib/api/schemas";
import { getProduct } from "@/lib/billing/products";
import { ClaudeAnalysisService } from "@/lib/ai/claude";
import { responseAdviceSchema } from "@/lib/ai/modules/schemas";
import { responseAdviceSystemPrompt } from "@/lib/ai/modules/prompts";
import { fenceContent, sanitiseForPrompt } from "@/lib/ai/injection";
import { serverConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { evaluateConsentGate } from "@/server/consent/gate";
import {
  releaseAdviceRequest,
  reserveAdviceRequest,
} from "@/server/advice/allowance";
import { json, readJson, withOwner } from "@/server/http";
import { getJob, recordUsage } from "@/server/repositories/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withOwner(
  async ({ ownerId, request }) => {
    const parsed = responseAdviceRequestSchema.safeParse(await readJson(request, 128 * 1024));
    if (!parsed.success) throw new AppError("INVALID_REQUEST");

    const job = getJob(parsed.data.jobId, ownerId);
    if (!job || job.status !== "COMPLETED") throw new AppError("NOT_FOUND");

    const product = getProduct(job.productId);
    if (!product?.allowedModules.includes("RESPONSE_ADVICE")) {
      throw new AppError("ENTITLEMENT_REQUIRED", {
        message: "Response suggestions aren't included in this analysis.",
        hint: "They come with the deep text analysis.",
      });
    }

    const gate = evaluateConsentGate(job.conversationId);
    if (!gate.satisfied) {
      throw gate.declined
        ? new AppError("CONSENT_DECLINED")
        : new AppError("CONSENT_REQUIRED");
    }

    const speaker =
      parsed.data.participants.find((p) => p.id === parsed.data.speakerId)?.label ??
      "the person asking";

    const transcript = parsed.data.messages
      .map((message) => {
        const label =
          parsed.data.participants.find((p) => p.id === message.p)?.label ?? message.p;
        return `[${message.id}] ${label}: ${sanitiseForPrompt(message.t)}`;
      })
      .join("\n");

    // Reserved before the call and released if it produces nothing, so a
    // provider failure never costs someone a request.
    const reservation = reserveAdviceRequest(job.id, ownerId, job.productId, "respond");

    const service = new ClaudeAnalysisService();
    service.onUsage((event) => {
      recordUsage({
        jobId: job.id,
        ownerId,
        module: "RESPONSE_ADVICE",
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
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
      });
    });

    let advice;
    try {
      advice = await service.runModule({
        moduleId: "RESPONSE_ADVICE",
        aiTask: "RESPONSE_ADVICE",
        systemContext: responseAdviceSystemPrompt(),
        task: [
          `You are writing options for ${speaker}, who sends the next message.`,
          parsed.data.intent
            ? `What they want to get across: ${sanitiseForPrompt(parsed.data.intent)}`
            : "They did not say what they want to get across; infer it from the exchange, and say so in 'reading'.",
          "",
          "THE EXCHANGE",
          fenceContent(transcript),
        ].join("\n"),
        schema: responseAdviceSchema,
        effort: serverConfig().anthropic.effort,
        maxOutputTokens: 3_000,
      });
    } catch (error) {
      releaseAdviceRequest(reservation.id);
      throw error;
    }

    return json({ advice, allowance: reservation.allowance });
  },
  { create: false, rateLimit: true },
);
