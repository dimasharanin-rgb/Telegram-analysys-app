/**
 * Typed client for the V2 API.
 *
 * One place that knows how a failure comes back, so every screen can render
 * the same `UserFacingError` shape and no component has to guess.
 */

import type { AnalysisModule } from "@/lib/analysis/modules";
import type { JobStatus } from "@/lib/analysis/job";
import type { ConsentStatus } from "@/lib/consent/state";
import type { UserFacingError } from "@/lib/errors";
import type { AnalysisResultV2 } from "@/lib/pipeline/modular";
import type { ConversationStatistics } from "@/lib/stats";
import type { AdvancedStatistics } from "@/lib/stats/advanced";
import type { ResponseAdvice, AvoidanceFindings } from "@/lib/ai/modules/schemas";
import type { AdviceAllowance } from "@/lib/advice/limits";

export class ApiError extends Error {
  readonly userFacing: UserFacingError;
  constructor(userFacing: UserFacingError) {
    super(userFacing.message);
    this.name = "ApiError";
    this.userFacing = userFacing;
  }
}

const GENERIC: UserFacingError = {
  code: "UNKNOWN",
  message: "Something went wrong.",
  hint: "Try again in a moment.",
  retryable: true,
};

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError({
      code: "NETWORK",
      message: "Couldn't reach the server.",
      hint: "Check your connection and try again.",
      retryable: true,
    });
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: UserFacingError }
      | null;
    throw new ApiError(body?.error ?? GENERIC);
  }

  return (await response.json()) as T;
}

/* -------------------------------------------------------------------------
 * Shapes
 * ---------------------------------------------------------------------- */

export interface ParticipantSummary {
  id: string;
  pseudonym: string;
  displayName: string;
  isSelf: boolean;
  messageCount: number;
}

export interface ConsentRequirement {
  participantId: string;
  pseudonym: string;
  displayName: string;
  isSelf: boolean;
  required: boolean;
  status: ConsentStatus | null;
  consentRequestId: string | null;
  expiresAt: string | null;
  satisfied: boolean;
}

export interface ConsentGate {
  requirements: ConsentRequirement[];
  satisfied: boolean;
  blocking: { participantId: string; displayName: string; reason: string }[];
  declined: boolean;
}

export interface JobSummary {
  id: string;
  status: JobStatus;
  progress: number;
  stageMessage: string | null;
  productId: string;
  productName: string;
  modules: AnalysisModule[];
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
  conversation: {
    id: string;
    title: string;
    messageCount: number;
    startDate: string;
    endDate: string;
  } | null;
}

export interface JobRecord {
  id: string;
  conversationId: string;
  productId: string;
  modules: AnalysisModule[];
  status: JobStatus;
  progress: number;
  stageMessage: string | null;
  entitlementId: string | null;
  inputMessageCount: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  actualCostMicros: number;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface EntitlementCheck {
  ok: boolean;
  reason?: "requires_purchase" | "free_limit_reached" | "unknown_product" | "unavailable";
}

export interface JobDetail {
  job: JobRecord;
  gate: ConsentGate;
  runnable: boolean;
  entitlement: EntitlementCheck;
  product: { id: string; name: string; priceMinor: number; currency: string } | null;
  conversation: {
    id: string;
    title: string;
    messageCount: number;
    startDate: string;
    endDate: string;
  };
  participants: { pseudonym: string; displayName: string; isSelf: boolean }[];
  usage: { module: string; inputTokens: number; outputTokens: number; costMicros: number }[];
  advice: AdviceAllowance;
}

export interface StoredStatistics {
  base: ConversationStatistics;
  advanced: AdvancedStatistics;
}

export interface EvidenceMessage {
  id: string;
  participantId: string;
  text: string;
  iso: string;
}

export interface JobResult {
  job: JobRecord;
  result: AnalysisResultV2;
  evidence: EvidenceMessage[];
  conversation: {
    id: string;
    title: string;
    messageCount: number;
    startDate: string;
    endDate: string;
    statistics: StoredStatistics;
  };
  participants: ParticipantSummary[];
}

/* -------------------------------------------------------------------------
 * Calls
 * ---------------------------------------------------------------------- */

export const api = {
  createConversation: (body: unknown) =>
    request<{
      conversation: { id: string; title: string };
      participants: ParticipantSummary[];
      gate: ConsentGate;
    }>("/api/conversations", { method: "POST", body: JSON.stringify(body) }),

  listConversations: () =>
    request<{ conversations: unknown[] }>("/api/conversations"),

  requestConsent: (conversationId: string, participantId: string) =>
    request<{
      consentRequest: { id: string; status: ConsentStatus; expiresAt: string };
      url: string;
      gate: ConsentGate;
    }>(`/api/conversations/${conversationId}/consent`, {
      method: "POST",
      body: JSON.stringify({ participantId }),
    }),

  createJob: (body: {
    conversationId: string;
    productId: string;
    modules: AnalysisModule[];
    input: unknown;
  }) =>
    request<{ job: JobRecord; gate: ConsentGate; entitlement: EntitlementCheck }>(
      "/api/jobs",
      { method: "POST", body: JSON.stringify(body) },
    ),

  listJobs: () => request<{ jobs: JobSummary[] }>("/api/jobs"),

  getJob: (jobId: string) => request<JobDetail>(`/api/jobs/${jobId}`),

  getResult: (jobId: string) => request<JobResult>(`/api/jobs/${jobId}/result`),

  deleteJob: (jobId: string) =>
    request<{ deleted?: boolean }>(`/api/jobs/${jobId}`, { method: "DELETE" }),

  checkout: (productId: string, returnPath: string) =>
    request<{ url: string; provider: string; simulated: boolean }>("/api/checkout", {
      method: "POST",
      body: JSON.stringify({ productId, returnPath }),
    }),

  confirmManualPayment: (reference: string, productId: string) =>
    request<{ applied: boolean; entitlementId?: string }>("/api/checkout/confirm", {
      method: "POST",
      body: JSON.stringify({ reference, productId }),
    }),

  account: () =>
    request<{
      entitlements: {
        productId: string;
        productName: string;
        creditsRemaining: number;
        creditsTotal: number;
        source: string;
        status: string;
        createdAt: string;
      }[];
      freeAnalysesAllowed: number;
      payments: {
        id: string;
        productId: string;
        amountMinor: number;
        currency: string;
        status: string;
        createdAt: string;
      }[];
      products: { id: string; name: string; priceLabel: string }[];
      payments_provider: { id: string; simulated: boolean };
    }>("/api/account"),

  responseAdvice: (body: unknown) =>
    request<{ advice: ResponseAdvice; allowance: AdviceAllowance }>("/api/advice/respond", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  avoidanceAdvice: (body: unknown) =>
    request<{ findings: AvoidanceFindings; allowance: AdviceAllowance }>("/api/advice/avoid", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

/* -------------------------------------------------------------------------
 * Running a job (SSE)
 * ---------------------------------------------------------------------- */

export interface RunProgress {
  stage: string;
  message: string;
  percent: number;
  step: number;
  totalSteps: number;
}

/**
 * Streams a run. Progress comes from the pipeline itself, so when a stage is
 * slow the bar sits still and names the stage rather than inventing movement.
 */
export async function runJob(
  jobId: string,
  options: { onProgress?: (event: RunProgress) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const response = await fetch(`/api/jobs/${jobId}/run`, {
    method: "POST",
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as
      | { error?: UserFacingError }
      | null;
    throw new ApiError(body?.error ?? GENERIC);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const line = frame.split("\n").find((entry) => entry.startsWith("data:"));
        if (!line) continue;

        let payload: { type?: string; data?: unknown };
        try {
          payload = JSON.parse(line.slice(5).trim()) as typeof payload;
        } catch {
          continue;
        }

        if (payload.type === "progress") {
          options.onProgress?.(payload.data as RunProgress);
        } else if (payload.type === "error") {
          throw new ApiError((payload.data as UserFacingError) ?? GENERIC);
        } else if (payload.type === "result") {
          finished = true;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!finished) {
    throw new ApiError({
      code: "NETWORK",
      message: "The analysis stopped before it finished.",
      hint: "This is usually a dropped connection. Open the analysis to see where it got to.",
      retryable: true,
    });
  }
}
