/**
 * GET /api/consent/:token/document — the consent document as a PDF.
 *
 * Authorised by the link token, so the participant can keep a copy of exactly
 * what they were shown without needing an account here.
 */

import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { renderConsentPdf } from "@/lib/pdf/consent-document";
import { errorResponse } from "@/server/http";
import { consentProvider } from "@/server/consent/provider";
import { getConversationUnscoped, getParticipant } from "@/server/repositories/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { token } = await context.params;
    const request = consentProvider().resolveToken(token);
    if (!request) throw new AppError("CONSENT_NOT_FOUND");

    const conversation = getConversationUnscoped(request.conversationId);
    const participant = getParticipant(request.participantId);
    if (!conversation || !participant) throw new AppError("NOT_FOUND");

    const pdf = await renderConsentPdf({
      consentId: request.id,
      participantName: participant.displayName,
      requestedByLabel: request.requestedByLabel,
      conversationTitle: conversation.title,
      messageCount: conversation.messageCount,
      dateRange: { start: conversation.startDate, end: conversation.endDate },
      dataTypes: request.dataTypes,
      purpose: request.purpose,
      aiProvider: request.aiProvider,
      expiresAt: request.expiresAt,
      status: request.status,
      createdAt: request.createdAt,
      decidedAt: request.decidedAt,
      withdrawnAt: request.withdrawnAt,
    });

    log.info("consent.document_downloaded", { consentId: request.id });

    const bytes = new Uint8Array(pdf);
    return new Response(bytes, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="consent-${request.id}.pdf"`,
        "content-length": String(bytes.byteLength),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
