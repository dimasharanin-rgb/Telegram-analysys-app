/**
 * GET    /api/jobs/:id — current status, re-evaluating what it is waiting for.
 * DELETE /api/jobs/:id — cancel or remove it.
 */

import { getProduct } from "@/lib/billing/products";
import { AppError } from "@/lib/errors";
import { checkEntitlement } from "@/server/billing/entitlements";
import { adviceAllowance } from "@/server/advice/allowance";
import { cancelJob, describeReadiness } from "@/server/analysis/job-service";
import { errorResponse, json, withOwner } from "@/server/http";
import { getConversation, listParticipants } from "@/server/repositories/conversations";
import { deleteJob, listUsage } from "@/server/repositories/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return withOwner(async ({ ownerId }) => {
    const readiness = describeReadiness(id, ownerId);
    const conversation = getConversation(readiness.job.conversationId, ownerId);
    if (!conversation) throw new AppError("NOT_FOUND");

    return json({
      job: readiness.job,
      gate: readiness.gate,
      runnable: readiness.runnable,
      entitlement: checkEntitlement(ownerId, readiness.job.productId),
      product: getProduct(readiness.job.productId),
      conversation: {
        id: conversation.id,
        title: conversation.title,
        messageCount: conversation.messageCount,
        startDate: conversation.startDate,
        endDate: conversation.endDate,
      },
      participants: listParticipants(conversation.id).map((p) => ({
        pseudonym: p.pseudonym,
        displayName: p.displayName,
        isSelf: p.isSelf,
      })),
      // Usage is internal detail; it is returned because it is the owner's own
      // spend, and the account page shows it.
      usage: listUsage(id),
      // What the advice page is allowed to spend, so it can say so before
      // the user clicks rather than after.
      advice: adviceAllowance(id, ownerId, readiness.job.productId),
    });
  }, { create: false })(request);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return withOwner(async ({ ownerId }) => {
    const readiness = describeReadiness(id, ownerId);
    if (readiness.job.status === "PROCESSING") {
      return errorResponse(new AppError("JOB_LOCKED"));
    }
    if (readiness.job.status === "COMPLETED" || readiness.job.status === "FAILED") {
      deleteJob(id, ownerId);
      return json({ deleted: true });
    }
    return json({ job: cancelJob(id, ownerId) });
  }, { create: false })(request);
}
