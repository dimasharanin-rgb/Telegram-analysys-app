/**
 * The V2 analysis request.
 *
 * Extends the base request with a digest of the advanced statistics, so the
 * modules interpret exact figures rather than recomputing anything, and with
 * the job's configuration. Every field is bounded, because this is an
 * untrusted request body until Zod has finished with it.
 */

import { z } from "zod";

import { ANALYSIS_MODULES, ANALYSIS_DEPTHS, CONTENT_TYPES } from "@/lib/analysis/modules";
import { INDICATOR_CATEGORIES } from "@/lib/stats/lexicon";
import { analysisRequestSchema } from "@/lib/ai/schema";

const indicatorCountsSchema = z.object(
  Object.fromEntries(
    INDICATOR_CATEGORIES.map((category) => [category, z.number().int().nonnegative()]),
  ) as Record<(typeof INDICATOR_CATEGORIES)[number], z.ZodNumber>,
);

export const participantInteractionSchema = z.object({
  doubleTexts: z.number().int().nonnegative(),
  bursts: z.number().int().nonnegative(),
  longestRun: z.number().int().nonnegative(),
  unansweredEndings: z.number().int().nonnegative(),
  questionsAsked: z.number().int().nonnegative(),
  questionsAnswered: z.number().int().nonnegative(),
  questionAnswerRate: z.number(),
  vocabularySize: z.number().int().nonnegative(),
  vocabularyDiversity: z.number(),
  averageWordsPerMessage: z.number(),
});

export const periodDigestSchema = z.object({
  id: z.string().max(16),
  label: z.string().max(40),
  startDate: z.string().max(12),
  endDate: z.string().max(12),
  messages: z.number().int().nonnegative(),
  averageLength: z.number(),
  medianResponseSeconds: z.number(),
  questionRate: z.number(),
  emojiRate: z.number(),
  conversations: z.number().int().nonnegative(),
  averageMessagesPerConversation: z.number(),
  initiationShare: z.record(z.string(), z.number()),
  indicators: indicatorCountsSchema,
  topWords: z.array(z.string().max(40)).max(10),
});

export const timelineChangeSchema = z.object({
  metric: z.string().max(40),
  label: z.string().max(80),
  direction: z.enum(["up", "down", "flat"]),
  changePercent: z.number(),
  earlyLabel: z.string().max(40),
  recentLabel: z.string().max(40),
});

export const conflictCandidateSchema = z.object({
  id: z.string().max(16),
  startIso: z.string().max(32),
  endIso: z.string().max(32),
  messageIds: z.array(z.string().max(64)).max(120),
  signals: z.array(z.string().max(120)).max(8),
  followedBySilenceSeconds: z.number().int().nonnegative(),
  repairFollowed: z.boolean(),
});

export const advancedDigestSchema = z.object({
  interaction: z.object({
    perParticipant: z.record(z.string(), participantInteractionSchema),
    reciprocity: z.object({
      messageBalance: z.number(),
      initiationBalance: z.number(),
      lengthBalance: z.number(),
      responseTimeRatio: z.number(),
      turns: z.number().int().nonnegative(),
      averageTurnsPerConversation: z.number(),
    }),
  }),
  emotional: z.object({
    perParticipant: z.record(z.string(), indicatorCountsSchema),
    overall: indicatorCountsSchema,
    messagesScored: z.number().int().nonnegative(),
  }),
  timeline: z.object({
    comparable: z.boolean(),
    note: z.string().max(400),
    periods: z.array(periodDigestSchema).max(6),
    changes: z.array(timelineChangeSchema).max(16),
  }),
  conflictCandidates: z.array(conflictCandidateSchema).max(10),
});

export type AdvancedDigest = z.infer<typeof advancedDigestSchema>;

/**
 * What the analysis actually read.
 *
 * Travels with the input so the run, the result and the PDF all know whether
 * they are describing the whole conversation, without anyone having to
 * recompute it or take it on trust.
 */
export const coverageSchema = z.object({
  totalMessages: z.number().int().nonnegative(),
  analysedMessages: z.number().int().nonnegative(),
  totalCharacters: z.number().int().nonnegative(),
  analysedCharacters: z.number().int().nonnegative(),
  partial: z.boolean(),
  budgetCharacters: z.number().int().positive().nullable(),
  analysedThrough: z.string().max(32).nullable(),
});

export const analysisJobInputSchema = analysisRequestSchema.extend({
  advanced: advancedDigestSchema,
  modules: z.array(z.enum(ANALYSIS_MODULES)).max(ANALYSIS_MODULES.length),
  contentTypes: z.array(z.enum(CONTENT_TYPES)).max(CONTENT_TYPES.length),
  depth: z.enum(ANALYSIS_DEPTHS),
  /** BCP-47 code the written report must come back in. */
  language: z.string().max(12).optional(),
  coverage: coverageSchema.optional(),
});

export type AnalysisJobInput = z.infer<typeof analysisJobInputSchema>;
