/**
 * Analysis job state machine and user-facing progress vocabulary.
 *
 * Pure, so the transition rules are testable on their own and the UI can
 * describe a job without asking the server what a status means.
 */

export const JOB_STATUSES = [
  "CREATED",
  "WAITING_FOR_CONSENT",
  "WAITING_FOR_PAYMENT",
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * A job may bounce between the two waiting states as requirements are met in
 * either order, and may return to WAITING_FOR_CONSENT from QUEUED if consent
 * is withdrawn before processing starts.
 */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  CREATED: ["WAITING_FOR_CONSENT", "WAITING_FOR_PAYMENT", "QUEUED", "CANCELLED", "FAILED"],
  WAITING_FOR_CONSENT: ["WAITING_FOR_PAYMENT", "QUEUED", "CANCELLED", "FAILED"],
  WAITING_FOR_PAYMENT: ["WAITING_FOR_CONSENT", "QUEUED", "CANCELLED", "FAILED"],
  QUEUED: ["PROCESSING", "WAITING_FOR_CONSENT", "WAITING_FOR_PAYMENT", "CANCELLED", "FAILED"],
  PROCESSING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class JobTransitionError extends Error {
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`Analysis job cannot move from ${from} to ${to}`);
    this.name = "JobTransitionError";
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new JobTransitionError(from, to);
}

export function isTerminal(status: JobStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** True while the job still needs something from the user. */
export function isBlocked(status: JobStatus): boolean {
  return status === "WAITING_FOR_CONSENT" || status === "WAITING_FOR_PAYMENT";
}

/** True when the job is live and the Analyze button must stay disabled. */
export function isActive(status: JobStatus): boolean {
  return status === "QUEUED" || status === "PROCESSING";
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  CREATED: "Getting ready",
  WAITING_FOR_CONSENT: "Waiting for participant consent",
  WAITING_FOR_PAYMENT: "Waiting for payment",
  QUEUED: "Ready to run",
  PROCESSING: "Analyzing",
  COMPLETED: "Complete",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/* -------------------------------------------------------------------------
 * Progress
 * ---------------------------------------------------------------------- */

/**
 * Stage names are deliberately about the conversation, not the infrastructure:
 * a user does not need to know how many model requests a stage costs.
 */
export const JOB_STAGES = [
  "preparing",
  "communication",
  "interaction",
  "topics",
  "emotional",
  "conflict",
  "timeline",
  "profiles",
  "advice",
  "synthesis",
  "validating",
  "done",
] as const;

export type JobStage = (typeof JOB_STAGES)[number];

export const JOB_STAGE_MESSAGES: Record<JobStage, string> = {
  preparing: "Preparing conversation",
  communication: "Analyzing communication patterns",
  interaction: "Comparing interaction styles",
  topics: "Finding recurring themes",
  emotional: "Reading emotional language",
  conflict: "Looking at difficult moments",
  timeline: "Comparing periods over time",
  profiles: "Building communication profiles",
  advice: "Preparing response suggestions",
  synthesis: "Bringing the findings together",
  validating: "Checking the analysis",
  done: "Preparing your insights",
};
