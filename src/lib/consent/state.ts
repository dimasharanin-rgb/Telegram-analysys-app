/**
 * Consent state machine.
 *
 * Pure and dependency-free so both the server and the UI can reason about a
 * consent request the same way, and so the transition rules can be tested
 * without a database.
 *
 * A consent request is a record of what was asked, of whom, on which version
 * of the document, and what they decided. It is not an electronic signature,
 * and nothing here should be described as one.
 */

export const CONSENT_STATUSES = [
  "PENDING",
  "VIEWED",
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
  "EXPIRED",
] as const;

export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CONSENT_EVENTS = [
  "REQUESTED",
  "VIEWED",
  "ACCEPTED",
  "DECLINED",
  "WITHDRAWN",
  "EXPIRED",
  "ANALYSIS_STARTED",
  "ANALYSIS_BLOCKED",
] as const;

export type ConsentEvent = (typeof CONSENT_EVENTS)[number];

/**
 * Allowed transitions.
 *
 * ACCEPTED can still move to WITHDRAWN - consent is revocable at any time.
 * DECLINED is final for this request: asking again means issuing a new one,
 * which keeps the original decision in the audit trail.
 */
const TRANSITIONS: Record<ConsentStatus, readonly ConsentStatus[]> = {
  PENDING: ["VIEWED", "ACCEPTED", "DECLINED", "EXPIRED"],
  VIEWED: ["ACCEPTED", "DECLINED", "EXPIRED"],
  ACCEPTED: ["WITHDRAWN"],
  DECLINED: [],
  WITHDRAWN: [],
  EXPIRED: [],
};

export function canTransition(from: ConsentStatus, to: ConsentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class ConsentTransitionError extends Error {
  constructor(
    readonly from: ConsentStatus,
    readonly to: ConsentStatus,
  ) {
    super(`Consent cannot move from ${from} to ${to}`);
    this.name = "ConsentTransitionError";
  }
}

export function assertTransition(from: ConsentStatus, to: ConsentStatus): void {
  if (!canTransition(from, to)) throw new ConsentTransitionError(from, to);
}

/** A request that can still be decided on. */
export function isOpen(status: ConsentStatus): boolean {
  return status === "PENDING" || status === "VIEWED";
}

/** Whether this request currently authorises processing. */
export function grantsPermission(status: ConsentStatus): boolean {
  return status === "ACCEPTED";
}

/** Terminal states never change again. */
export function isTerminal(status: ConsentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * Applies expiry as a read-time rule as well as a stored one: a request whose
 * deadline has passed is treated as EXPIRED even if no background job has
 * written that yet.
 */
export function effectiveStatus(
  status: ConsentStatus,
  expiresAt: string,
  now: Date = new Date(),
): ConsentStatus {
  if (!isOpen(status)) return status;
  return Date.parse(expiresAt) <= now.getTime() ? "EXPIRED" : status;
}

/* -------------------------------------------------------------------------
 * What consent covers
 * ---------------------------------------------------------------------- */

export const CONSENT_DATA_TYPES = ["TEXT", "IMAGES", "AUDIO", "VIDEO"] as const;
export type ConsentDataType = (typeof CONSENT_DATA_TYPES)[number];

/** Only text is analysed today; the rest are declared but never requested. */
/**
 * Content types this build can actually process.
 *
 * A capability statement, not a default. Video is absent because V3 analyses
 * none, so a participant can never be asked to consent to it.
 */
export const SUPPORTED_DATA_TYPES: readonly ConsentDataType[] = [
  "TEXT",
  "IMAGES",
  "AUDIO",
];

/**
 * What a consent request asks for when the caller does not say.
 *
 * Text only, deliberately. Asking every participant to authorise having their
 * photographs examined and their voice sent to a transcription service - on the
 * chance that the analysis might want to - is the wrong default: it requests
 * more than most analyses need, and a consent form that over-asks trains people
 * to skim it. A media analysis passes the wider set explicitly.
 */
export const DEFAULT_REQUESTED_DATA_TYPES: readonly ConsentDataType[] = ["TEXT"];

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  PENDING: "Waiting for a response",
  VIEWED: "Opened, not yet answered",
  ACCEPTED: "Consent given",
  DECLINED: "Consent declined",
  WITHDRAWN: "Consent withdrawn",
  EXPIRED: "Request expired",
};
