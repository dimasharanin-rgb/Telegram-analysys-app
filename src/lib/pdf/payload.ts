/**
 * The exact data the PDF report needs.
 *
 * It is built in the browser from the local statistics and posted to the
 * export route. Deliberately narrow: no message text, no per-message data, no
 * AI evidence excerpts - a report someone might email should not carry the
 * conversation with it.
 */

import { z } from "zod";

export const pdfParticipantSchema = z.object({
  id: z.string().max(64),
  name: z.string().min(1).max(80),
  messages: z.number().int().nonnegative(),
  sharePercent: z.number().min(0).max(100),
  initiations: z.number().int().nonnegative(),
  initiationSharePercent: z.number().min(0).max(100),
  medianResponseSeconds: z.number().nonnegative(),
  averageResponseSeconds: z.number().nonnegative(),
  averageMessageCharacters: z.number().nonnegative(),
});
export type PdfParticipant = z.infer<typeof pdfParticipantSchema>;

export const pdfReportSchema = z.object({
  generatedAt: z.string().max(40),
  conversationTitle: z.string().min(1).max(120),
  dateRange: z.object({
    start: z.string().max(20),
    end: z.string().max(20),
    spanDays: z.number().int().nonnegative(),
  }),
  totals: z.object({
    messages: z.number().int().nonnegative(),
    activeDays: z.number().int().nonnegative(),
    averagePerActiveDay: z.number().nonnegative(),
    conversations: z.number().int().nonnegative(),
    averageMessagesPerConversation: z.number().nonnegative(),
    mediaMessages: z.number().int().nonnegative(),
  }),
  participants: z.array(pdfParticipantSchema).min(1).max(12),
  activity: z
    .array(
      z.object({
        label: z.string().max(24),
        count: z.number().int().nonnegative(),
      }),
    )
    .max(80),
  activityUnit: z.enum(["day", "week", "month"]),
  topWords: z
    .array(z.object({ word: z.string().max(40), count: z.number().int().nonnegative() }))
    .max(16),
  overview: z
    .object({
      summary: z.string().max(1500),
      confidence: z.enum(["high", "medium", "low"]),
    })
    .nullable(),
  methodology: z.array(z.string().max(500)).max(12),

  /* --- V2 sections. All optional, so a statistics-only report still works. */

  /** Application version, printed on the cover. */
  appVersion: z.string().max(20).optional(),
  /**
   * Stated on the cover when the analysis read only part of the
   * conversation. The report outlives the screen that explained the choice.
   */
  coverageNote: z.string().max(400).optional(),
  analysisType: z.string().max(40).optional(),

  keyInsights: z
    .array(
      z.object({
        title: z.string().max(120),
        observation: z.string().max(600),
        interpretation: z.string().max(700),
        uncertainty: z.string().max(500),
      }),
    )
    .max(8)
    .optional(),

  profiles: z
    .array(
      z.object({
        name: z.string().max(80),
        headline: z.string().max(200),
        traits: z
          .array(
            z.object({
              label: z.string().max(60),
              level: z.string().max(30),
              basis: z.string().max(300),
            }),
          )
          .max(8),
        strengths: z.array(z.string().max(300)).max(4),
        watchouts: z.array(z.string().max(300)).max(4),
      }),
    )
    .max(6)
    .optional(),

  interactionPatterns: z
    .array(
      z.object({
        title: z.string().max(120),
        observation: z.string().max(600),
        interpretation: z.string().max(700),
      }),
    )
    .max(6)
    .optional(),

  timelineChanges: z
    .array(
      z.object({
        title: z.string().max(120),
        earlier: z.string().max(400),
        later: z.string().max(400),
      }),
    )
    .max(8)
    .optional(),

  /**
   * What happened to the attachments.
   *
   * Counts and safe labels, matching what the page shows, because §19 asks for
   * one result read by both. Note what cannot be here: no image is embedded, no
   * classification is named, and a withheld attachment contributes a line
   * saying it existed and nothing about what was in it - §36.
   */
  media: z
    .object({
      summary: z.string().max(400),
      items: z
        .array(
          z.object({
            when: z.string().max(40),
            participant: z.string().max(40),
            label: z.string().max(80),
            detail: z.string().max(240).nullable(),
          }),
        )
        .max(40),
    })
    .optional(),

  conflicts: z
    .array(
      z.object({
        title: z.string().max(120),
        trigger: z.string().max(500),
        repair: z.string().max(500),
        resolution: z.string().max(40),
      }),
    )
    .max(6)
    .optional(),

  suggestions: z
    .array(
      z.object({
        title: z.string().max(120),
        doThis: z.string().max(400),
        avoidThis: z.string().max(400),
      }),
    )
    .max(6)
    .optional(),

  /** A small number of quoted exchanges, never the conversation. */
  evidence: z
    .array(
      z.object({
        label: z.string().max(80),
        lines: z
          .array(
            z.object({
              speaker: z.string().max(80),
              text: z.string().max(600),
            }),
          )
          .max(12),
      }),
    )
    .max(6)
    .optional(),

  /** Reference to the consent records this analysis ran under. */
  consent: z
    .object({
      documentVersion: z.string().max(20),
      participants: z
        .array(
          z.object({
            name: z.string().max(80),
            status: z.string().max(40),
            decidedAt: z.string().max(40).nullable(),
          }),
        )
        .max(12),
    })
    .nullable()
    .optional(),
});

export type PdfReportPayload = z.infer<typeof pdfReportSchema>;
