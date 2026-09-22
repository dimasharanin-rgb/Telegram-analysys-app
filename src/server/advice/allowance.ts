/**
 * Enforcing the advice allowance.
 *
 * The rule the UI shows ("2 requests remaining") has to be the rule the
 * server applies, and it has to hold when two clicks land at once. So the
 * check and the spend are one statement, not a read followed by a write:
 * the INSERT carries its own guard, and a second concurrent request finds
 * the row count already at the limit.
 *
 * A request is reserved before the model is called and released if the call
 * produces nothing, so a provider failure does not cost someone an allowance
 * they never got the benefit of - the same contract the analysis credits use.
 */

import { adviceAllowanceFor, describeAllowance, type AdviceAllowance } from "@/lib/advice/limits";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { getDb } from "@/server/db/client";
import { newId } from "@/server/ids";

export type AdviceKind = "respond" | "avoid";

/** How many AI advice requests this analysis has spent. */
export function countAdviceRequests(jobId: string, ownerId: string): number {
  const row = getDb()
    .prepare<[string, string], { used: number }>(
      "SELECT COUNT(*) AS used FROM advice_requests WHERE job_id = ? AND owner_id = ?",
    )
    .get(jobId, ownerId);
  return row?.used ?? 0;
}

export function adviceAllowance(
  jobId: string,
  ownerId: string,
  productId: string,
): AdviceAllowance {
  return describeAllowance(productId, countAdviceRequests(jobId, ownerId));
}

export interface ReservedAdvice {
  id: string;
  allowance: AdviceAllowance;
}

/**
 * Takes one request from the allowance, or refuses.
 *
 * The guard is inside the INSERT ... SELECT: the row only appears when the
 * count is still under the limit at the moment of writing, so two requests
 * arriving together cannot both take the last one.
 */
export function reserveAdviceRequest(
  jobId: string,
  ownerId: string,
  productId: string,
  kind: AdviceKind,
): ReservedAdvice {
  const total = adviceAllowanceFor(productId);
  const id = newId("adv");

  const inserted = getDb()
    .prepare(
      `INSERT INTO advice_requests (id, job_id, owner_id, kind, created_at)
       SELECT ?, ?, ?, ?, ?
       WHERE (
         SELECT COUNT(*) FROM advice_requests WHERE job_id = ? AND owner_id = ?
       ) < ?`,
    )
    .run(id, jobId, ownerId, kind, new Date().toISOString(), jobId, ownerId, total);

  if (inserted.changes === 0) {
    throw new AppError("ENTITLEMENT_REQUIRED", {
      message:
        total === 0
          ? "This analysis doesn't include AI advice requests."
          : `You've used all ${total} advice requests included with this analysis.`,
      hint: "The written guidance is still available, and costs nothing.",
      detail: `advice allowance exhausted for job ${jobId}`,
    });
  }

  log.info("advice.reserved", { kind, productId });
  return { id, allowance: adviceAllowance(jobId, ownerId, productId) };
}

/** Hands the request back when the model produced nothing usable. */
export function releaseAdviceRequest(reservationId: string): void {
  getDb().prepare("DELETE FROM advice_requests WHERE id = ?").run(reservationId);
  log.info("advice.released", {});
}
