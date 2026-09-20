/**
 * Output schemas for the V2 analysis modules.
 *
 * Every module returns a bounded, validated object. Bounds matter twice over:
 * they stop a runaway response filling a page, and they cap what an injected
 * instruction inside the conversation could ever cause to be rendered.
 *
 * All of them reuse the same evidence and confidence shapes as the base pass,
 * so the evidence drawer works identically everywhere.
 */

import { z } from "zod";

import { confidenceSchema, evidenceSchema } from "@/lib/ai/schema";

/* -------------------------------------------------------------------------
 * Interaction dynamics
 * ---------------------------------------------------------------------- */

export const interactionFindingsSchema = z.object({
  summary: z.string().min(1).max(900),
  patterns: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        observation: z.string().min(1).max(600),
        interpretation: z.string().max(700),
        uncertainty: z.string().max(500),
        evidence: z.array(evidenceSchema).max(4),
        confidence: confidenceSchema,
      }),
    )
    .max(8),
});
export type InteractionFindings = z.infer<typeof interactionFindingsSchema>;

/* -------------------------------------------------------------------------
 * Emotional language
 * ---------------------------------------------------------------------- */

export const emotionalFindingsSchema = z.object({
  summary: z.string().min(1).max(900),
  observations: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        observation: z.string().min(1).max(600),
        interpretation: z.string().max(700),
        uncertainty: z.string().max(500),
        evidence: z.array(evidenceSchema).max(4),
        confidence: confidenceSchema,
      }),
    )
    .max(6),
});
export type EmotionalFindings = z.infer<typeof emotionalFindingsSchema>;

/* -------------------------------------------------------------------------
 * Difficult moments
 * ---------------------------------------------------------------------- */

export const RESOLUTION_STATES = ["resolved", "paused", "unresolved", "unclear"] as const;

export const conflictFindingsSchema = z.object({
  summary: z.string().min(1).max(900),
  conflicts: z
    .array(
      z.object({
        /** Which shortlisted exchange this refers to. */
        candidateId: z.string().max(16),
        title: z.string().min(1).max(120),
        /** What the exchange appears to start from. */
        trigger: z.string().min(1).max(500),
        /** What changes in the messages as it develops. */
        escalation: z.string().max(600),
        responses: z
          .array(
            z.object({
              participant: z.string().max(40),
              description: z.string().min(1).max(400),
            }),
          )
          .max(4),
        /** Apologies, clarifications, humour, topic changes. */
        repair: z.string().max(500),
        resolution: z.enum(RESOLUTION_STATES),
        recurrence: z.string().max(400),
        evidence: z.array(evidenceSchema).max(4),
        confidence: confidenceSchema,
      }),
    )
    .max(6),
});
export type ConflictFindings = z.infer<typeof conflictFindingsSchema>;

/* -------------------------------------------------------------------------
 * Change over time
 * ---------------------------------------------------------------------- */

export const timelineFindingsSchema = z.object({
  summary: z.string().min(1).max(900),
  changes: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        /** What the earlier period looked like. */
        earlier: z.string().min(1).max(400),
        /** What the recent period looks like. */
        later: z.string().min(1).max(400),
        interpretation: z.string().max(600),
        uncertainty: z.string().max(400),
        evidence: z.array(evidenceSchema).max(3),
        confidence: confidenceSchema,
      }),
    )
    .max(8),
  continuities: z.array(z.string().max(300)).max(4),
});
export type TimelineFindings = z.infer<typeof timelineFindingsSchema>;

/* -------------------------------------------------------------------------
 * Communication profiles
 * ---------------------------------------------------------------------- */

export const TRAIT_LEVELS = ["high", "moderate", "low", "insufficient-evidence"] as const;

export const profileFindingsSchema = z.object({
  profiles: z
    .array(
      z.object({
        /** Pseudonymous participant id, e.g. "A". */
        participantId: z.string().max(8),
        headline: z.string().min(1).max(200),
        traits: z
          .array(
            z.object({
              /** Behaviour being described, never a personality label. */
              label: z.string().min(1).max(60),
              level: z.enum(TRAIT_LEVELS),
              /** The countable thing the level rests on. */
              basis: z.string().min(1).max(300),
            }),
          )
          .max(8),
        strengths: z.array(z.string().max(300)).max(4),
        watchouts: z.array(z.string().max(300)).max(4),
        evidence: z.array(evidenceSchema).max(3),
        confidence: confidenceSchema,
      }),
    )
    .max(6),
});
export type ProfileFindings = z.infer<typeof profileFindingsSchema>;

/* -------------------------------------------------------------------------
 * On-demand advice
 * ---------------------------------------------------------------------- */

export const RESPONSE_STYLES = [
  "direct",
  "warm",
  "short",
  "boundary-setting",
  "de-escalating",
] as const;

export type ResponseStyle = (typeof RESPONSE_STYLES)[number];

export const responseAdviceSchema = z.object({
  /** What the model understood the situation to be, so the user can correct it. */
  reading: z.string().min(1).max(600),
  suggestions: z
    .array(
      z.object({
        style: z.enum(RESPONSE_STYLES),
        /** The message itself, ready to send. */
        text: z.string().min(1).max(800),
        why: z.string().min(1).max(400),
      }),
    )
    .min(1)
    .max(5),
  caution: z.string().max(400),
});
export type ResponseAdvice = z.infer<typeof responseAdviceSchema>;

export const avoidanceFindingsSchema = z.object({
  summary: z.string().min(1).max(600),
  patterns: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        /** The wording in the excerpt that tends to escalate. */
        pattern: z.string().min(1).max(400),
        why: z.string().min(1).max(500),
        alternative: z.string().min(1).max(500),
        evidence: z.array(evidenceSchema).max(3),
      }),
    )
    .max(6),
  note: z.string().max(400),
});
export type AvoidanceFindings = z.infer<typeof avoidanceFindingsSchema>;
