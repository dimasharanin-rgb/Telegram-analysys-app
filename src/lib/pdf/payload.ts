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
  methodology: z.array(z.string().max(500)).max(6),
});

export type PdfReportPayload = z.infer<typeof pdfReportSchema>;
