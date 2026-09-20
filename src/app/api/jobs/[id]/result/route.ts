/**
 * GET /api/jobs/:id/result — the finished analysis and its evidence.
 *
 * Evidence is returned from the stored excerpts, which by this point have been
 * pruned to exactly the messages the analysis cites. That is what lets an
 * analysis be reopened months later without the original export, while still
 * keeping only the minimum.
 */

import type { AnalysisJobInput } from "@/lib/ai/modules/input";
import { AppError } from "@/lib/errors";
import { json, withOwner } from "@/server/http";
import { getConversation, listParticipants } from "@/server/repositories/conversations";
import { getJob, getJobInput, getJobResult } from "@/server/repositories/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export interface EvidenceMessage {
  id: string;
  /** Pseudonymous participant id, resolved to a name by the client. */
  participantId: string;
  text: string;
  iso: string;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;

  return withOwner(async ({ ownerId }) => {
    const job = getJob(id, ownerId);
    if (!job) throw new AppError("NOT_FOUND");

    const result = getJobResult(id);
    if (!result) {
      throw new AppError("NOT_FOUND", {
        message: "This analysis hasn't produced a result yet.",
      });
    }

    const conversation = getConversation(job.conversationId, ownerId);
    const stored = getJobInput(id);
    const evidence: EvidenceMessage[] = [];

    if (stored) {
      const payload = stored.payload as AnalysisJobInput;
      for (const excerpt of payload.excerpts ?? []) {
        const start = Date.parse(`${excerpt.startIso}Z`);
        for (const message of excerpt.messages) {
          evidence.push({
            id: message.id,
            participantId: message.p,
            text: message.t,
            iso: Number.isFinite(start)
              ? new Date(start + message.m * 60_000).toISOString().slice(0, 19)
              : excerpt.startIso,
          });
        }
      }
    }

    return json({
      job,
      result,
      evidence,
      conversation,
      participants: conversation ? listParticipants(conversation.id) : [],
    });
  }, { create: false })(request);
}
