/**
 * POST /api/conversations — register an imported conversation.
 * GET  /api/conversations — the owner's import history.
 *
 * Only metadata and aggregate statistics are stored. The export file and the
 * full message history stay in the browser.
 */

import { createConversationSchema } from "@/lib/api/schemas";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { evaluateConsentGate } from "@/server/consent/gate";
import { json, readJson, withOwner } from "@/server/http";
import {
  createConversation,
  listConversations,
  listParticipants,
} from "@/server/repositories/conversations";
import { listJobsForConversation } from "@/server/repositories/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withOwner(async ({ ownerId, request }) => {
  const parsed = createConversationSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    log.warn("conversations.invalid", {
      issue: parsed.error.issues[0]?.path.join(".") ?? "unknown",
    });
    throw new AppError("INVALID_REQUEST");
  }

  // Exactly one participant may be marked as the uploader; everyone else needs
  // a consent request of their own.
  const selfCount = parsed.data.participants.filter((p) => p.isSelf).length;
  if (selfCount !== 1) {
    throw new AppError("INVALID_REQUEST", {
      message: "Tell us which participant is you before continuing.",
      detail: `selfCount=${selfCount}`,
    });
  }

  const conversation = createConversation({ ownerId, ...parsed.data });
  const participants = listParticipants(conversation.id);

  log.info("conversation.created", {
    conversationId: conversation.id,
    participants: participants.length,
    messages: conversation.messageCount,
  });

  return json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      messageCount: conversation.messageCount,
      startDate: conversation.startDate,
      endDate: conversation.endDate,
      createdAt: conversation.createdAt,
    },
    participants: participants.map((p) => ({
      id: p.id,
      pseudonym: p.pseudonym,
      displayName: p.displayName,
      isSelf: p.isSelf,
      messageCount: p.messageCount,
    })),
    gate: evaluateConsentGate(conversation.id),
  }, { status: 201 });
});

export const GET = withOwner(async ({ ownerId }) => {
  const conversations = listConversations(ownerId).map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    messageCount: conversation.messageCount,
    startDate: conversation.startDate,
    endDate: conversation.endDate,
    createdAt: conversation.createdAt,
    participants: listParticipants(conversation.id).map((p) => ({
      displayName: p.displayName,
      isSelf: p.isSelf,
    })),
    jobs: listJobsForConversation(conversation.id).map((job) => ({
      id: job.id,
      status: job.status,
      productId: job.productId,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    })),
  }));

  return json({ conversations });
});
