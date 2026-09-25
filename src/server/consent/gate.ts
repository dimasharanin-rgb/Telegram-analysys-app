/**
 * The consent gate.
 *
 * One rule, enforced in one place: a job may not enter processing unless every
 * participant whose consent is required has given it, and none has withdrawn
 * or declined.
 *
 * The uploader is not treated as authority over anyone else's messages. Their
 * own acknowledgement is captured at import; every other participant needs a
 * request of their own.
 */

import type { ConsentDataType, ConsentStatus } from "@/lib/consent/state";
import { listConsentForConversation } from "@/server/repositories/consent";
import { listParticipants } from "@/server/repositories/conversations";
import type { ParticipantRecord } from "@/server/repositories/conversations";

export interface ConsentRequirement {
  participantId: string;
  pseudonym: string;
  displayName: string;
  isSelf: boolean;
  /** False only for the uploader, who confirms at import. */
  required: boolean;
  /** Status of the most recent request, or null if none has been sent. */
  status: ConsentStatus | null;
  consentRequestId: string | null;
  expiresAt: string | null;
  satisfied: boolean;
}

export type GateBlocker =
  | "NOT_REQUESTED"
  | "AWAITING_DECISION"
  | "DECLINED"
  | "WITHDRAWN"
  | "EXPIRED";

export interface ConsentGateResult {
  requirements: ConsentRequirement[];
  /**
   * Content types every required participant actually agreed to.
   *
   * The intersection, not the union: if one person's consent covers text and
   * images and another's covers text alone, only text may be analysed. §33 -
   * consent to have words read is not consent to have photographs opened, and
   * one participant cannot agree on another's behalf.
   */
  consentedDataTypes: ConsentDataType[];
  satisfied: boolean;
  /** Participants still standing between the job and processing. */
  blocking: { participantId: string; displayName: string; reason: GateBlocker }[];
  /** True when someone actively said no - a different message to "waiting". */
  declined: boolean;
}

function blockerFor(status: ConsentStatus | null): GateBlocker | null {
  if (status === null) return "NOT_REQUESTED";
  switch (status) {
    case "ACCEPTED":
      return null;
    case "PENDING":
    case "VIEWED":
      return "AWAITING_DECISION";
    case "DECLINED":
      return "DECLINED";
    case "WITHDRAWN":
      return "WITHDRAWN";
    case "EXPIRED":
      return "EXPIRED";
  }
}

/**
 * Picks the request that decides a participant's state.
 *
 * An accepted request wins over anything else, so re-sending a link after
 * someone has already agreed cannot accidentally re-block the analysis. A
 * withdrawal always wins over an acceptance, because withdrawal is a later
 * decision on the same consent.
 */
function decisiveStatus(
  statuses: { status: ConsentStatus; id: string; expiresAt: string }[],
): { status: ConsentStatus; id: string; expiresAt: string } | null {
  if (statuses.length === 0) return null;

  const withdrawn = statuses.find((entry) => entry.status === "WITHDRAWN");
  if (withdrawn) return withdrawn;

  const accepted = statuses.find((entry) => entry.status === "ACCEPTED");
  if (accepted) return accepted;

  const open = statuses.find(
    (entry) => entry.status === "PENDING" || entry.status === "VIEWED",
  );
  if (open) return open;

  const declined = statuses.find((entry) => entry.status === "DECLINED");
  if (declined) return declined;

  return statuses[statuses.length - 1]!;
}

export function evaluateConsentGate(conversationId: string): ConsentGateResult {
  const participants = listParticipants(conversationId);
  const requests = listConsentForConversation(conversationId);

  const byParticipant = new Map<
    string,
    { status: ConsentStatus; id: string; expiresAt: string }[]
  >();
  for (const request of requests) {
    const list = byParticipant.get(request.participantId) ?? [];
    list.push({
      status: request.status,
      id: request.id,
      expiresAt: request.expiresAt,
    });
    byParticipant.set(request.participantId, list);
  }

  const requirements: ConsentRequirement[] = participants.map(
    (participant: ParticipantRecord) => {
      const decisive = decisiveStatus(byParticipant.get(participant.id) ?? []);
      const required = !participant.isSelf;
      const status = decisive?.status ?? null;

      return {
        participantId: participant.id,
        pseudonym: participant.pseudonym,
        displayName: participant.displayName,
        isSelf: participant.isSelf,
        required,
        status,
        consentRequestId: decisive?.id ?? null,
        expiresAt: decisive?.expiresAt ?? null,
        satisfied: !required || status === "ACCEPTED",
      };
    },
  );

  // Data types are intersected across the participants whose consent was
  // actually needed. The uploader is excluded here for the same reason they are
  // not `required`: they agreed at import, and the scope they agreed to is the
  // product's, not a separate consent record.
  const grantedByRequired = requirements
    .filter((requirement) => requirement.required && requirement.satisfied)
    .map((requirement) => {
      const record = requests.find((entry) => entry.id === requirement.consentRequestId);
      return record?.dataTypes ?? [];
    });

  const consentedDataTypes = intersectDataTypes(grantedByRequired);

  const blocking = requirements
    .filter((requirement) => requirement.required && !requirement.satisfied)
    .map((requirement) => ({
      participantId: requirement.participantId,
      displayName: requirement.displayName,
      reason: blockerFor(requirement.status) ?? "AWAITING_DECISION",
    }));

  return {
    requirements,
    consentedDataTypes,
    satisfied: blocking.length === 0,
    blocking,
    declined: blocking.some((entry) => entry.reason === "DECLINED"),
  };
}

/**
 * What every grant has in common.
 *
 * No grants at all means nothing is consented, not everything: an analysis with
 * no required participants is the uploader's own monologue, and there is no
 * media consent to infer from silence.
 */
function intersectDataTypes(
  grants: readonly ConsentDataType[][],
): ConsentDataType[] {
  if (grants.length === 0) return [];

  const first = grants[0]!;
  return first.filter((type) => grants.every((grant) => grant.includes(type)));
}
