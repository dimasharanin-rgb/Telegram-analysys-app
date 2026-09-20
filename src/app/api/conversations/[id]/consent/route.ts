/**
 * POST /api/conversations/:id/consent — ask a participant for consent.
 *
 * Returns the link exactly once. The token itself is never stored, so it
 * cannot be recovered afterwards: a lost link means sending a new request,
 * which is the safer failure.
 */

import { createConsentRequestSchema } from "@/lib/api/schemas";
import { serverConfig } from "@/lib/config";
import { SUPPORTED_DATA_TYPES } from "@/lib/consent/state";
import { AppError } from "@/lib/errors";
import { consentProvider } from "@/server/consent/provider";
import { evaluateConsentGate } from "@/server/consent/gate";
import { json, readJson, withOwner } from "@/server/http";
import {
  getConversation,
  getParticipant,
  listParticipants,
} from "@/server/repositories/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;

  return withOwner(async ({ ownerId }) => {
    const conversation = getConversation(id, ownerId);
    if (!conversation) throw new AppError("NOT_FOUND");

    const parsed = createConsentRequestSchema.safeParse(await readJson(request, 8_192));
    if (!parsed.success) throw new AppError("INVALID_REQUEST");

    const participant = getParticipant(parsed.data.participantId);
    // The participant must belong to this conversation - an id from someone
    // else's conversation must not resolve here.
    if (!participant || participant.conversationId !== id) throw new AppError("NOT_FOUND");
    if (participant.isSelf) {
      throw new AppError("INVALID_REQUEST", {
        message: "You don't need to ask yourself for consent.",
      });
    }

    const self = listParticipants(id).find((entry) => entry.isSelf);
    const config = serverConfig();

    const created = consentProvider().createRequest({
      ownerId,
      conversationId: id,
      participantId: participant.id,
      requestedByLabel: self?.displayName ?? "The person who exported this chat",
      // Only text is analysed in this build, so only text is ever requested.
      dataTypes: parsed.data.dataTypes ?? [...SUPPORTED_DATA_TYPES],
      purpose:
        "To produce a descriptive analysis of how this conversation works: statistics about messaging patterns, and written commentary on communication patterns.",
      aiProvider: config.consent.aiProviderName,
      validForDays: config.consent.validForDays,
    });

    return json(
      {
        consentRequest: {
          id: created.request.id,
          participantId: created.request.participantId,
          status: created.request.status,
          expiresAt: created.request.expiresAt,
          documentVersion: created.request.documentVersion,
        },
        // Shown once so the requester can pass it on however they like.
        url: `${config.consent.appUrl}/consent/${created.token}`,
        gate: evaluateConsentGate(id),
      },
      { status: 201 },
    );
  }, { create: false })(request);
}
