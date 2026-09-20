/**
 * POST /api/consent/withdraw — the participant takes consent back.
 *
 * Available from the same link, with no reason required and no deadline. Any
 * job still waiting to run is blocked by the gate the next time it is checked.
 */

import { consentWithdrawSchema } from "@/lib/api/schemas";
import { AppError } from "@/lib/errors";
import { consentProvider } from "@/server/consent/provider";
import { errorResponse, json, readJson } from "@/server/http";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const limit = checkRateLimit(`consent:${clientKey(request.headers)}`, 20, 10 * 60_000);
    if (!limit.allowed) {
      return errorResponse(new AppError("RATE_LIMITED"), {
        "retry-after": String(limit.retryAfterSeconds),
      });
    }

    const parsed = consentWithdrawSchema.safeParse(await readJson(request, 4_096));
    if (!parsed.success) throw new AppError("INVALID_REQUEST");

    const updated = consentProvider().withdraw(parsed.data.token);
    return json({ status: updated.status, withdrawnAt: updated.withdrawnAt });
  } catch (error) {
    return errorResponse(error);
  }
}
