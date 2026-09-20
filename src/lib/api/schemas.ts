/**
 * Request schemas for the V2 API.
 *
 * Shared between the route handlers and the client, so a change to a payload
 * is a type error rather than a runtime surprise.
 */

import { z } from "zod";

import { ANALYSIS_MODULES } from "@/lib/analysis/modules";
import { CONSENT_DATA_TYPES } from "@/lib/consent/state";

/**
 * A size- and depth-bounded JSON value.
 *
 * Used for the statistics blob a conversation carries. Its exact shape is
 * produced by this application's own code and is only ever rendered back to
 * the owner who sent it, so full structural validation would buy little; what
 * matters is that a request cannot smuggle in something enormous or
 * pathologically nested.
 */
const MAX_JSON_DEPTH = 8;

export const boundedJson = z.custom<unknown>(
  (value) => withinBounds(value, MAX_JSON_DEPTH),
  { message: "Value is too deeply nested" },
);

function withinBounds(value: unknown, depth: number): boolean {
  if (depth < 0) return false;
  if (value === null) return true;
  switch (typeof value) {
    case "string":
      return value.length <= 4_000;
    case "number":
      return Number.isFinite(value);
    case "boolean":
      return true;
    case "object":
      if (Array.isArray(value)) {
        return value.length <= 5_000 && value.every((item) => withinBounds(item, depth - 1));
      }
      return (
        Object.keys(value).length <= 500 &&
        Object.values(value).every((item) => withinBounds(item, depth - 1))
      );
    default:
      return false;
  }
}

export const createConversationSchema = z.object({
  title: z.string().min(1).max(120),
  source: z.string().max(40),
  chatType: z.string().max(40),
  messageCount: z.number().int().nonnegative().max(5_000_000),
  startDate: z.string().max(12),
  endDate: z.string().max(12),
  spanDays: z.number().int().nonnegative().max(100_000),
  timezoneOffsetMinutes: z.number().int().min(-720).max(840).nullable(),
  statistics: boundedJson,
  participants: z
    .array(
      z.object({
        pseudonym: z.string().min(1).max(8),
        displayName: z.string().min(1).max(80),
        isSelf: z.boolean(),
        messageCount: z.number().int().nonnegative(),
      }),
    )
    .min(2)
    .max(12),
});
export type CreateConversationRequest = z.infer<typeof createConversationSchema>;

export const createConsentRequestSchema = z.object({
  participantId: z.string().min(1).max(64),
  dataTypes: z.array(z.enum(CONSENT_DATA_TYPES)).min(1).max(4).optional(),
});

export const consentDecisionSchema = z.object({
  token: z.string().min(16).max(128),
  decision: z.enum(["ACCEPTED", "DECLINED"]),
});

export const consentWithdrawSchema = z.object({
  token: z.string().min(16).max(128),
});

export const createJobSchema = z.object({
  conversationId: z.string().min(1).max(64),
  productId: z.string().min(1).max(40),
  modules: z.array(z.enum(ANALYSIS_MODULES)).min(1).max(ANALYSIS_MODULES.length),
  /** Validated properly by analysisJobInputSchema inside the job service. */
  input: boundedJson,
});

export const checkoutSchema = z.object({
  productId: z.string().min(1).max(40),
  /** Where to return after checkout; must be a path on this application. */
  returnPath: z.string().max(200).optional(),
});

export const manualConfirmSchema = z.object({
  reference: z.string().min(1).max(80),
  productId: z.string().min(1).max(40),
});

/** One excerpt handed to the on-demand advice tools. */
export const adviceExcerptSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().max(64),
        p: z.string().max(8),
        t: z.string().max(2_000),
      }),
    )
    .min(1)
    .max(60),
  participants: z
    .array(z.object({ id: z.string().max(8), label: z.string().max(40) }))
    .min(1)
    .max(12),
  /** Whose next message the advice is for. */
  speakerId: z.string().max(8),
});

export const responseAdviceRequestSchema = adviceExcerptSchema.extend({
  jobId: z.string().min(1).max(64),
  /** Optional extra context the user typed. */
  intent: z.string().max(500).optional(),
});

export const avoidanceRequestSchema = adviceExcerptSchema.extend({
  jobId: z.string().min(1).max(64),
});
