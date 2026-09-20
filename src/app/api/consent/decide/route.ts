/**
 * POST /api/consent/decide — the participant's answer.
 *
 * Authorised by the link token alone, because the person answering is not the
 * account holder and must not be asked to create one. The token is the
 * capability; it is single-purpose, expiring and revocable, and only its hash
 * is stored.
 */

import { consentDecisionSchema } from "@/lib/api/schemas";
import { AppError } from "@/lib/errors";
import { consentProvider } from "@/server/consent/provider";
import { errorResponse, json, readJson } from "@/server/http";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    // Token guessing is the threat here, so the limit is on the caller.
    const limit = checkRateLimit(`consent:${clientKey(request.headers)}`, 20, 10 * 60_000);
    if (!limit.allowed) {
      return errorResponse(new AppError("RATE_LIMITED"), {
        "retry-after": String(limit.retryAfterSeconds),
      });
    }

    const parsed = consentDecisionSchema.safeParse(await readJson(request, 4_096));
    if (!parsed.success) throw new AppError("INVALID_REQUEST");

    const updated = consentProvider().decide(parsed.data.token, parsed.data.decision);

    return json({
      status: updated.status,
      decidedAt: updated.decidedAt,
      documentVersion: updated.documentVersion,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
