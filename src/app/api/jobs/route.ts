/**
 * POST /api/jobs — prepare an analysis.
 * GET  /api/jobs — this owner's analyses, newest first.
 *
 * Creating a job does not run it and does not spend a credit. It records what
 * was asked for and reports what is still standing in the way.
 */

import { createJobSchema } from "@/lib/api/schemas";
import { getProduct } from "@/lib/billing/products";
import { AppError } from "@/lib/errors";
import { checkEntitlement } from "@/server/billing/entitlements";
import { createAnalysisJob } from "@/server/analysis/job-service";
import { json, readJson, withOwner } from "@/server/http";
import { getConversation } from "@/server/repositories/conversations";
import { listJobs } from "@/server/repositories/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withOwner(
  async ({ ownerId, request }) => {
    const parsed = createJobSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError("INVALID_REQUEST");

    const { job, gate } = createAnalysisJob({
      ownerId,
      conversationId: parsed.data.conversationId,
      productId: parsed.data.productId,
      modules: parsed.data.modules,
      input: parsed.data.input,
    });

    return json(
      {
        job,
        gate,
        entitlement: checkEntitlement(ownerId, job.productId),
      },
      { status: 201 },
    );
  },
  { rateLimit: true },
);

export const GET = withOwner(async ({ ownerId }) => {
  const items = listJobs(ownerId).map((job) => {
    const conversation = getConversation(job.conversationId, ownerId);
    const product = getProduct(job.productId);
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      stageMessage: job.stageMessage,
      productId: job.productId,
      productName: product?.name ?? job.productId,
      modules: job.modules,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      errorCode: job.errorCode,
      conversation: conversation
        ? {
            id: conversation.id,
            title: conversation.title,
            messageCount: conversation.messageCount,
            startDate: conversation.startDate,
            endDate: conversation.endDate,
          }
        : null,
    };
  });

  return json({ jobs: items });
});
