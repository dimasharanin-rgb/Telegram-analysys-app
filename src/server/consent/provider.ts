/**
 * Consent provider abstraction.
 *
 * The application asks *a* consent provider to obtain and track a decision. The
 * one shipped here keeps the record itself; a future integration with a
 * qualified e-signature service would implement the same interface, and nothing
 * upstream of it would change.
 *
 * The distinction matters for honesty as much as for architecture: this
 * implementation produces a consent *record*, not a qualified signature, and
 * the interface is deliberately named so that no caller can confuse the two.
 */

import { AppError } from "@/lib/errors";
import { CONSENT_DOCUMENT_VERSION } from "@/lib/consent/document";
import {
  effectiveStatus,
  type ConsentDataType,
  type ConsentStatus,
} from "@/lib/consent/state";
import { log } from "@/lib/logger";
import * as consentRepo from "@/server/repositories/consent";
import type { ConsentRequestRecord } from "@/server/repositories/consent";

export interface CreateConsentRequestInput {
  ownerId: string;
  conversationId: string;
  participantId: string;
  requestedByLabel: string;
  dataTypes: ConsentDataType[];
  purpose: string;
  aiProvider: string;
  /**
   * Who transcribes voice messages. Optional: a request that does not cover
   * audio should not name a processor that will receive nothing.
   */
  transcriptionProvider?: string;
  /** How long the link stays usable. */
  validForDays: number;
}

export interface CreatedConsentRequest {
  request: ConsentRequestRecord;
  /** Available exactly once, at creation. Only its hash is stored. */
  token: string;
}

export type ConsentDecision = "ACCEPTED" | "DECLINED";

export interface ConsentProvider {
  readonly id: string;
  createRequest(input: CreateConsentRequestInput): CreatedConsentRequest;
  getStatus(requestId: string): ConsentStatus | null;
  /** Resolves a link token to the request it belongs to. */
  resolveToken(token: string): ConsentRequestRecord | null;
  markViewed(token: string): ConsentRequestRecord;
  decide(token: string, decision: ConsentDecision): ConsentRequestRecord;
  /** Withdrawal by the participant, using their own link. */
  withdraw(token: string): ConsentRequestRecord;
  /** Cancellation by the requester, e.g. when deleting a conversation. */
  revoke(requestId: string, ownerId: string): ConsentRequestRecord;
}

/**
 * The built-in provider: consent records kept by this application.
 */
export class InternalConsentProvider implements ConsentProvider {
  readonly id = "internal";

  createRequest(input: CreateConsentRequestInput): CreatedConsentRequest {
    const expiresAt = new Date(
      Date.now() + input.validForDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const created = consentRepo.createConsentRequest({
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      participantId: input.participantId,
      requestedByLabel: input.requestedByLabel,
      dataTypes: input.dataTypes,
      purpose: input.purpose,
      aiProvider: input.aiProvider,
      // Recorded only when audio is actually in scope, so the stored record
      // says who was named to this participant rather than who happens to be
      // configured now.
      transcriptionProvider: input.dataTypes.includes("AUDIO")
        ? (input.transcriptionProvider ?? null)
        : null,
      documentVersion: CONSENT_DOCUMENT_VERSION,
      expiresAt,
    });

    log.info("consent.requested", {
      consentId: created.request.id,
      conversationId: input.conversationId,
      dataTypes: input.dataTypes.join(","),
      documentVersion: CONSENT_DOCUMENT_VERSION,
    });

    return created;
  }

  getStatus(requestId: string): ConsentStatus | null {
    return consentRepo.getConsentRequest(requestId)?.status ?? null;
  }

  resolveToken(token: string): ConsentRequestRecord | null {
    return consentRepo.findByToken(token);
  }

  markViewed(token: string): ConsentRequestRecord {
    const request = this.requireOpenish(token);
    // Only the first view is recorded; re-opening the page is not an event.
    if (request.status !== "PENDING") return request;
    return consentRepo.transition(request.id, "VIEWED", "participant");
  }

  decide(token: string, decision: ConsentDecision): ConsentRequestRecord {
    const request = this.requireOpenish(token);
    if (request.status !== "PENDING" && request.status !== "VIEWED") {
      throw consentClosed(request.status);
    }
    const updated = consentRepo.transition(request.id, decision, "participant");
    log.info("consent.decided", { consentId: request.id, decision });
    return updated;
  }

  withdraw(token: string): ConsentRequestRecord {
    const request = this.resolveToken(token);
    if (!request) throw unknownConsent();
    if (request.status !== "ACCEPTED") {
      throw new AppError("CONSENT_NOT_WITHDRAWABLE", {
        detail: `status ${request.status}`,
      });
    }
    const updated = consentRepo.transition(request.id, "WITHDRAWN", "participant");
    log.info("consent.withdrawn", { consentId: request.id });
    return updated;
  }

  revoke(requestId: string, ownerId: string): ConsentRequestRecord {
    const request = consentRepo.getConsentRequest(requestId);
    if (!request || request.ownerId !== ownerId) throw unknownConsent();
    if (request.status === "ACCEPTED") {
      return consentRepo.transition(requestId, "WITHDRAWN", "requester", {
        reason: "revoked_by_requester",
      });
    }
    if (request.status === "PENDING" || request.status === "VIEWED") {
      return consentRepo.transition(requestId, "EXPIRED", "requester", {
        reason: "cancelled_by_requester",
      });
    }
    return request;
  }

  /** Resolves a token and rejects anything already past its deadline. */
  private requireOpenish(token: string): ConsentRequestRecord {
    const request = this.resolveToken(token);
    if (!request) throw unknownConsent();

    const live = effectiveStatus(request.status, request.expiresAt);
    if (live === "EXPIRED" && request.status !== "EXPIRED") {
      // Persist the expiry so the audit trail records it once.
      return consentRepo.transition(request.id, "EXPIRED", "system");
    }
    if (live === "EXPIRED") throw consentClosed("EXPIRED");
    return request;
  }
}

function unknownConsent(): AppError {
  return new AppError("CONSENT_NOT_FOUND");
}

function consentClosed(status: ConsentStatus): AppError {
  return new AppError("CONSENT_CLOSED", { detail: `status ${status}` });
}

let provider: ConsentProvider = new InternalConsentProvider();

export function consentProvider(): ConsentProvider {
  return provider;
}

/** Test seam, and the hook a future e-signature integration plugs into. */
export function setConsentProvider(next: ConsentProvider): void {
  provider = next;
}
