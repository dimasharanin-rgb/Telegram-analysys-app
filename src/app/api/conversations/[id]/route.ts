/**
 * GET    /api/conversations/:id — detail, including the consent gate.
 * DELETE /api/conversations/:id — remove it and everything hanging off it.
 */

import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { evaluateConsentGate } from "@/server/consent/gate";
import { errorResponse, json, withOwner } from "@/server/http";
import {
  deleteConversation,
  getConversation,
  listParticipants,
} from "@/server/repositories/conversations";
import { listConsentForConversation } from "@/server/repositories/consent";
import { listJobsForConversation } from "@/server/repositories/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return withOwner(async ({ ownerId }) => {
    const conversation = getConversation(id, ownerId);
    if (!conversation) throw new AppError("NOT_FOUND");

    return json({
      conversation,
      participants: listParticipants(id),
      gate: evaluateConsentGate(id),
      consentRequests: listConsentForConversation(id).map((entry) => ({
        id: entry.id,
        participantId: entry.participantId,
        status: entry.status,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        decidedAt: entry.decidedAt,
      })),
      jobs: listJobsForConversation(id),
    });
  }, { create: false })(request);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return withOwner(async ({ ownerId }) => {
    if (!deleteConversation(id, ownerId)) return errorResponse(new AppError("NOT_FOUND"));
    log.info("conversation.deleted", { conversationId: id });
    return json({ deleted: true });
  }, { create: false })(request);
}
