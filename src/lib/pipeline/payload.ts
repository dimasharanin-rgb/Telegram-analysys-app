/**
 * Builds the request that leaves the browser.
 *
 * Two things happen here that matter for privacy and cost:
 *
 *  - Participants are pseudonymised. Telegram display names never leave the
 *    device; Claude sees "Participant A" and "Participant B", and the UI puts
 *    the real names back when it renders the analysis.
 *
 *  - Only a digest of the statistics travels, not the full object. The daily
 *    series, per-hour breakdowns and per-participant word lists stay local -
 *    they are rendered in the Stats tab and printed in the PDF, but the model
 *    has no use for them.
 */

import type { ConversationSegment } from "@/lib/analysis/segmentation";
import type { AnalysisRequest, StatisticsDigest } from "@/lib/ai/schema";
import type { Conversation, NormalizedMessage } from "@/lib/model/message";
import { WEEKDAY_LABELS, type ConversationStatistics } from "@/lib/stats";
import { selectExcerpts } from "./excerpts";

export const PSEUDONYM_PREFIX = "Participant ";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export interface PseudonymMap {
  /** Real participant id → pseudonymous id ("A", "B", …). */
  toPseudonym: Map<string, string>;
  /** Pseudonymous id → real display name. */
  toDisplayName: Map<string, string>;
}

export function buildPseudonyms(conversation: Conversation): PseudonymMap {
  const toPseudonym = new Map<string, string>();
  const toDisplayName = new Map<string, string>();
  conversation.participants.forEach((participant, index) => {
    const pseudonym = ALPHABET[index] ?? `P${index + 1}`;
    toPseudonym.set(participant.id, pseudonym);
    toDisplayName.set(pseudonym, participant.name);
  });
  return { toPseudonym, toDisplayName };
}

function remap(
  values: Record<string, number>,
  toPseudonym: ReadonlyMap<string, string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, pseudonym] of toPseudonym) {
    out[pseudonym] = values[id] ?? 0;
  }
  return out;
}

export function buildStatisticsDigest(
  statistics: ConversationStatistics,
  toPseudonym: ReadonlyMap<string, string>,
): StatisticsDigest {
  const medianResponse: Record<string, number> = {};
  const averageResponse: Record<string, number> = {};
  const averageLength: Record<string, number> = {};
  const questionRate: Record<string, number> = {};
  const emojiRate: Record<string, number> = {};
  const consecutive: Record<string, number> = {};

  for (const [id, pseudonym] of toPseudonym) {
    medianResponse[pseudonym] = statistics.response.perParticipant[id]?.medianSeconds ?? 0;
    averageResponse[pseudonym] = statistics.response.perParticipant[id]?.averageSeconds ?? 0;
    averageLength[pseudonym] =
      statistics.general.lengthPerParticipant[id]?.averageCharacters ?? 0;
    questionRate[pseudonym] = statistics.characteristics.perParticipant[id]?.questionRate ?? 0;
    emojiRate[pseudonym] = statistics.characteristics.perParticipant[id]?.emojiRate ?? 0;
    consecutive[pseudonym] =
      statistics.characteristics.perParticipant[id]?.averageConsecutiveMessages ?? 0;
  }

  return {
    totalMessages: statistics.general.totalMessages,
    dateRange: {
      start: statistics.general.dateRange.start,
      end: statistics.general.dateRange.end,
    },
    activeDays: statistics.general.activeDays,
    spanDays: statistics.general.dateRange.spanDays,
    messageShare: remap(statistics.general.sharePerParticipant, toPseudonym),
    initiationShare: remap(statistics.initiation.sharePerParticipant, toPseudonym),
    totalConversations: statistics.initiation.totalConversations,
    averageMessagesPerConversation: statistics.initiation.averageMessagesPerConversation,
    medianResponseSeconds: medianResponse,
    averageResponseSeconds: averageResponse,
    averageMessageCharacters: averageLength,
    questionRate,
    emojiRate,
    averageConsecutiveMessages: consecutive,
    busiestHour: statistics.time.busiestHour,
    busiestWeekday:
      statistics.time.busiestWeekday !== null
        ? (WEEKDAY_LABELS[statistics.time.busiestWeekday] ?? null)
        : null,
    topWords: statistics.words.top.slice(0, 20).map((entry) => entry.word),
    topPhrases: statistics.words.phrases.slice(0, 8).map((entry) => entry.phrase),
    mediaMessages: statistics.meta.mediaMessages,
  };
}

export interface BuiltPayload {
  request: AnalysisRequest;
  pseudonyms: PseudonymMap;
  /** Message ids actually sent, for resolving evidence locally. */
  includedIds: string[];
  /** Characters of conversation text included, shown in the consent screen. */
  excerptCharacters: number;
}

export interface BuildPayloadOptions {
  charBudget?: number;
  maxSegments?: number;
  acceptedAt?: string;
}

export function buildAnalysisRequest(
  conversation: Conversation,
  statistics: ConversationStatistics,
  segments: readonly ConversationSegment[],
  options: BuildPayloadOptions = {},
): BuiltPayload {
  const pseudonyms = buildPseudonyms(conversation);

  const selection = selectExcerpts(
    conversation.messages as readonly NormalizedMessage[],
    segments,
    pseudonyms.toPseudonym,
    {
      charBudget: options.charBudget ?? 45_000,
      ...(options.maxSegments !== undefined ? { maxSegments: options.maxSegments } : {}),
    },
  );

  const participants = conversation.participants.map((participant) => {
    const pseudonym = pseudonyms.toPseudonym.get(participant.id) ?? "?";
    return {
      id: pseudonym,
      label: `${PSEUDONYM_PREFIX}${pseudonym}`,
      messageCount: participant.messageCount,
      sharePercent: statistics.general.sharePerParticipant[participant.id] ?? 0,
    };
  });

  const request: AnalysisRequest = {
    consent: {
      accepted: true,
      acceptedAt: options.acceptedAt ?? new Date().toISOString(),
      scope: "text-only",
    },
    participants,
    statistics: buildStatisticsDigest(statistics, pseudonyms.toPseudonym),
    excerpts: selection.excerpts,
  };

  return {
    request,
    pseudonyms,
    includedIds: [...selection.includedIds],
    excerptCharacters: selection.totalCharacters,
  };
}

/**
 * Replaces "Participant A" with the real display name for presentation.
 * Longer pseudonyms are substituted first so "Participant AB" cannot be
 * partially matched.
 */
export function humanise(text: string, toDisplayName: ReadonlyMap<string, string>): string {
  const entries = [...toDisplayName.entries()].sort((a, b) => b[0].length - a[0].length);
  let output = text;
  for (const [pseudonym, name] of entries) {
    output = output.split(`${PSEUDONYM_PREFIX}${pseudonym}`).join(name);
  }
  return output;
}
