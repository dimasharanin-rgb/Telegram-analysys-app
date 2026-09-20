/**
 * Schemas for everything that crosses a trust boundary.
 *
 *  - `analysisRequestSchema` validates what the browser sends to /api/analyze.
 *  - `analysisSchema` validates what Claude sends back.
 *
 * Model output is never trusted: it is parsed, bounded (string lengths, array
 * sizes) and cross-checked against the message ids we actually sent before any
 * of it reaches the UI.
 */

import { z } from "zod";

/* -------------------------------------------------------------------------
 * Claude output
 * ---------------------------------------------------------------------- */

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const INSIGHT_CATEGORIES = [
  "communication",
  "response-patterns",
  "conversation-dynamics",
  "recurring-topics",
  "positive-patterns",
  "things-to-watch",
] as const;

export const categorySchema = z.enum(INSIGHT_CATEGORIES);
export type InsightCategory = z.infer<typeof categorySchema>;

export const evidenceSchema = z.object({
  messageIds: z.array(z.string().max(64)).max(8),
  excerpt: z.string().max(600),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const patternSchema = z.object({
  title: z.string().min(1).max(120),
  category: categorySchema,
  /** The neutral, checkable statement of what happens in the conversation. */
  observation: z.string().min(1).max(600),
  /** What the pattern might mean, always framed as one reading among others. */
  interpretation: z.string().max(800),
  /** Why the reading is uncertain - what the data cannot establish. */
  uncertainty: z.string().max(500),
  evidence: z.array(evidenceSchema).max(5),
  confidence: confidenceSchema,
});
export type Pattern = z.infer<typeof patternSchema>;

export const highlightSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(700),
  evidence: z.array(evidenceSchema).max(4),
});
export type Highlight = z.infer<typeof highlightSchema>;

export const suggestionSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(700),
  do: z.string().max(400),
  avoid: z.string().max(400),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const topicSchema = z.object({
  topic: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  frequency: z.string().max(80),
});
export type RecurringTopic = z.infer<typeof topicSchema>;

export const analysisSchema = z.object({
  overview: z.object({
    summary: z.string().min(1).max(1200),
    confidence: confidenceSchema,
  }),
  patterns: z.array(patternSchema).max(10),
  strengths: z.array(highlightSchema).max(6),
  watchouts: z.array(highlightSchema).max(6),
  suggestions: z.array(suggestionSchema).max(6),
  recurringTopics: z.array(topicSchema).max(8),
});
export type Analysis = z.infer<typeof analysisSchema>;

/**
 * Map-phase output for large conversations. Deliberately narrower than the
 * final schema - a chunk sees only part of the conversation, so it reports
 * observations rather than conclusions.
 */
export const chunkFindingsSchema = z.object({
  periodSummary: z.string().min(1).max(800),
  observations: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        category: categorySchema,
        observation: z.string().min(1).max(600),
        evidence: z.array(evidenceSchema).max(3),
        confidence: confidenceSchema,
      }),
    )
    .max(8),
  topics: z.array(topicSchema).max(6),
});
export type ChunkFindings = z.infer<typeof chunkFindingsSchema>;

/* -------------------------------------------------------------------------
 * Request from the browser
 * ---------------------------------------------------------------------- */

/**
 * Participants are pseudonymised before they leave the browser: Claude sees
 * "Participant A"/"Participant B", never the Telegram display names. The UI
 * substitutes the real names back in when rendering.
 */
export const requestParticipantSchema = z.object({
  id: z.string().min(1).max(8),
  label: z.string().min(1).max(40),
  messageCount: z.number().int().nonnegative(),
  sharePercent: z.number().min(0).max(100),
});

export const excerptMessageSchema = z.object({
  /** Original message id, used to link evidence back to the local data. */
  id: z.string().max(64),
  /** Pseudonymous participant id. */
  p: z.string().max(8),
  /** Minutes since the start of this excerpt, keeping rhythm without dates. */
  m: z.number().int().nonnegative(),
  /** Message text, truncated. Empty for a media message. */
  t: z.string().max(1000),
  /** Present only when the message is media, as a short marker. */
  media: z.string().max(20).optional(),
});
export type ExcerptMessage = z.infer<typeof excerptMessageSchema>;

export const excerptSchema = z.object({
  id: z.string().max(32),
  startIso: z.string().max(32),
  endIso: z.string().max(32),
  totalMessages: z.number().int().nonnegative(),
  messages: z.array(excerptMessageSchema).max(200),
});
export type Excerpt = z.infer<typeof excerptSchema>;

/** Compact digest of the local statistics - never the full object. */
export const statisticsDigestSchema = z.object({
  totalMessages: z.number().int().nonnegative(),
  dateRange: z.object({ start: z.string().max(32), end: z.string().max(32) }),
  activeDays: z.number().int().nonnegative(),
  spanDays: z.number().int().nonnegative(),
  messageShare: z.record(z.string(), z.number()),
  initiationShare: z.record(z.string(), z.number()),
  totalConversations: z.number().int().nonnegative(),
  averageMessagesPerConversation: z.number(),
  medianResponseSeconds: z.record(z.string(), z.number()),
  averageResponseSeconds: z.record(z.string(), z.number()),
  averageMessageCharacters: z.record(z.string(), z.number()),
  questionRate: z.record(z.string(), z.number()),
  emojiRate: z.record(z.string(), z.number()),
  averageConsecutiveMessages: z.record(z.string(), z.number()),
  busiestHour: z.number().int().min(0).max(23).nullable(),
  busiestWeekday: z.string().max(16).nullable(),
  topWords: z.array(z.string().max(40)).max(30),
  topPhrases: z.array(z.string().max(80)).max(10),
  mediaMessages: z.number().int().nonnegative(),
});
export type StatisticsDigest = z.infer<typeof statisticsDigestSchema>;

export const analysisRequestSchema = z.object({
  consent: z.object({
    accepted: z.literal(true),
    acceptedAt: z.string().max(40),
    scope: z.literal("text-only"),
  }),
  participants: z.array(requestParticipantSchema).min(2).max(12),
  statistics: statisticsDigestSchema,
  excerpts: z.array(excerptSchema).min(1).max(60),
});
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

/* -------------------------------------------------------------------------
 * Post-validation of model output
 * ---------------------------------------------------------------------- */

/**
 * Drops evidence references to message ids that were never sent. A model
 * inventing an id is not a crash, but it must not reach the evidence drawer.
 */
export function pruneUnknownEvidence<T extends { evidence: Evidence[] }>(
  items: T[],
  knownIds: ReadonlySet<string>,
): T[] {
  return items.map((item) => ({
    ...item,
    evidence: item.evidence
      .map((entry) => ({
        ...entry,
        messageIds: entry.messageIds.filter((id) => knownIds.has(id)),
      }))
      .filter((entry) => entry.messageIds.length > 0 || entry.excerpt.trim().length > 0),
  }));
}

export function sanitiseAnalysis(
  analysis: Analysis,
  knownIds: ReadonlySet<string>,
): Analysis {
  return {
    ...analysis,
    patterns: pruneUnknownEvidence(analysis.patterns, knownIds),
    strengths: pruneUnknownEvidence(analysis.strengths, knownIds),
    watchouts: pruneUnknownEvidence(analysis.watchouts, knownIds),
  };
}
