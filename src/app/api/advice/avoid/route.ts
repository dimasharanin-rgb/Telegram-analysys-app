/**
 * POST /api/advice/avoid — "what might land badly?"
 *
 * The mirror of the response tool: same gates, same on-demand shape, but it
 * looks at wording the user has already sent rather than what to send next.
 */

import { avoidanceRequestSchema } from "@/lib/api/schemas";
import { getProduct } from "@/lib/billing/products";
import { ClaudeAnalysisService } from "@/lib/ai/claude";
import { avoidanceFindingsSchema } from "@/lib/ai/modules/schemas";
import { avoidanceSystemPrompt } from "@/lib/ai/modules/prompts";
import { fenceContent, sanitiseForPrompt } from "@/lib/ai/injection";
import { serverConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { costMicros } from "@/lib/pipeline/modular";
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
    const parsed = avoidanceRequestSchema.safeParse(await readJson(request, 128 * 1024));
    if (!parsed.success) throw new AppError("INVALID_REQUEST");

    const job = getJob(parsed.data.jobId, ownerId);
    if (!job || job.status !== "COMPLETED") throw new AppError("NOT_FOUND");

    const product = getProduct(job.productId);
    if (!product?.allowedModules.includes("AVOIDANCE_PATTERNS")) {
      throw new AppError("ENTITLEMENT_REQUIRED", {
        message: "This tool isn't included in this analysis.",
        hint: "It comes with the deep text analysis.",
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
    const reservation = reserveAdviceRequest(job.id, ownerId, job.productId, "avoid");

    const service = new ClaudeAnalysisService();
    service.onUsage((event) => {
      recordUsage({
        jobId: job.id,
        ownerId,
        module: "AVOIDANCE_PATTERNS",
        model: event.model,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        costMicros: costMicros(event),
      });
    });

    let findings;
    try {
      findings = await service.runModule({
        moduleId: "AVOIDANCE_PATTERNS",
        systemContext: avoidanceSystemPrompt(),
        task: [
          `Look at the messages sent by ${speaker}. Cite message ids from the excerpt as evidence.`,
          "",
          "THE EXCHANGE",
          fenceContent(transcript),
        ].join("\n"),
        schema: avoidanceFindingsSchema,
        effort: serverConfig().anthropic.effort,
        maxOutputTokens: 3_000,
      });
    } catch (error) {
      releaseAdviceRequest(reservation.id);
      throw error;
    }

    return json({ findings, allowance: reservation.allowance });
  },
  { create: false, rateLimit: true },
);
