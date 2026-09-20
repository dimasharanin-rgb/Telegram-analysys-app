/**
 * The local statistics engine.
 *
 * Every number the product shows as a fact is computed here, from the complete
 * message set, without any model involvement. The raw inputs (message array)
 * stay available to the caller so that individual calculations can be improved
 * later without re-parsing.
 */

import {
  DEFAULT_GAP_MINUTES,
  segmentConversations,
  segmentationDescription,
  type ConversationSegment,
} from "@/lib/analysis/segmentation";
import { MessageType, type Conversation, type NormalizedMessage } from "@/lib/model/message";
import { isStopword } from "./stopwords";
import type {
  ConversationStatistics,
  DailyPoint,
  LengthStats,
  MonthlyPoint,
  ParticipantCharacteristics,
  PhraseCount,
  ResponseBucket,
  ResponseStats,
  WordCount,
} from "./types";

export * from "./types";

/* -------------------------------------------------------------------------
 * Small numeric helpers
 * ---------------------------------------------------------------------- */

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function emptyResponseStats(): ResponseStats {
  return {
    count: 0,
    averageSeconds: 0,
    medianSeconds: 0,
    p90Seconds: 0,
    fastestSeconds: 0,
    slowestSeconds: 0,
  };
}

function summariseResponses(values: number[]): ResponseStats {
  if (values.length === 0) return emptyResponseStats();
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    averageSeconds: round(mean(sorted), 1),
    medianSeconds: round(median(sorted), 1),
    p90Seconds: round(percentile(sorted, 90), 1),
    fastestSeconds: round(sorted[0]!, 1),
    slowestSeconds: round(sorted[sorted.length - 1]!, 1),
  };
}

/* -------------------------------------------------------------------------
 * Text helpers
 * ---------------------------------------------------------------------- */

const EMOJI = /\p{Extended_Pictographic}/gu;
const LINK = /\b(?:https?:\/\/|www\.)\S+/giu;
const QUESTION = /[?？]/u;
const EXCLAMATION = /[!！]/u;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(text) !== null) count += 1;
  pattern.lastIndex = 0;
  return count;
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  WORD.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD.exec(text)) !== null) {
    // Trailing punctuation from quoted speech ("'mm'") is not part of the word.
    const token = match[0].toLowerCase().replace(/^['’-]+|['’-]+$/gu, "");
    if (token.length > 0) tokens.push(token);
  }
  return tokens;
}

/**
 * Contractions are written several ways ("i'll", "i’ll", "ill"). Comparing a
 * form with the apostrophes removed means the stopword list only has to carry
 * one spelling of each.
 */
function stopwordKey(token: string): string {
  return token.replace(/['’]/gu, "");
}

function isMeaningful(token: string): boolean {
  if (token.length < 3) return false;
  if (isStopword(token) || isStopword(stopwordKey(token))) return false;
  // Pure numbers say nothing about a conversation.
  if (/^[\p{N}'’-]+$/u.test(token)) return false;
  return true;
}

function lengthStats(texts: readonly string[]): LengthStats {
  if (texts.length === 0) {
    return { averageCharacters: 0, medianCharacters: 0, averageWords: 0, longestCharacters: 0 };
  }
  const lengths = texts.map((text) => text.length);
  const sorted = [...lengths].sort((a, b) => a - b);
  const wordCounts = texts.map((text) => tokenize(text).length);
  return {
    averageCharacters: round(mean(lengths), 1),
    medianCharacters: round(median(sorted), 1),
    averageWords: round(mean(wordCounts), 1),
    longestCharacters: sorted[sorted.length - 1]!,
  };
}

/* -------------------------------------------------------------------------
 * Response buckets
 * ---------------------------------------------------------------------- */

const BUCKETS: Omit<ResponseBucket, "count">[] = [
  { id: "lt1m", label: "Under 1 min", fromSeconds: 0, toSeconds: 60 },
  { id: "1to5m", label: "1–5 min", fromSeconds: 60, toSeconds: 300 },
  { id: "5to15m", label: "5–15 min", fromSeconds: 300, toSeconds: 900 },
  { id: "15to60m", label: "15–60 min", fromSeconds: 900, toSeconds: 3600 },
  { id: "1to3h", label: "1–3 hours", fromSeconds: 3600, toSeconds: 10_800 },
  { id: "gt3h", label: "3+ hours", fromSeconds: 10_800, toSeconds: null },
];

/* -------------------------------------------------------------------------
 * Main entry point
 * ---------------------------------------------------------------------- */

export interface StatisticsOptions {
  /** Inactivity gap that separates two conversations, in minutes. */
  conversationGapMinutes?: number;
  /** How many words to return in the top-words list. */
  topWords?: number;
}

export interface StatisticsResult {
  statistics: ConversationStatistics;
  segments: ConversationSegment[];
}

export function computeStatistics(
  conversation: Conversation,
  options: StatisticsOptions = {},
): StatisticsResult {
  const gapMinutes = options.conversationGapMinutes ?? DEFAULT_GAP_MINUTES;
  const topWords = options.topWords ?? 25;
  const messages = conversation.messages;
  const participants = conversation.participants.map((p) => ({ id: p.id, name: p.name }));
  const ids = participants.map((p) => p.id);

  const segments = segmentConversations(messages, gapMinutes);

  /* --- general ---------------------------------------------------------- */

  const perParticipant: Record<string, number> = {};
  const textsPerParticipant: Record<string, string[]> = {};
  for (const id of ids) {
    perParticipant[id] = 0;
    textsPerParticipant[id] = [];
  }

  const allTexts: string[] = [];
  const dayCounts = new Map<string, number>();
  const monthCounts = new Map<string, MonthlyPoint>();
  const byHour = new Array<number>(24).fill(0);
  const byWeekday = new Array<number>(7).fill(0);
  const byHourPerParticipant: Record<string, number[]> = {};
  for (const id of ids) byHourPerParticipant[id] = new Array<number>(24).fill(0);

  for (const message of messages) {
    perParticipant[message.senderId] = (perParticipant[message.senderId] ?? 0) + 1;

    // Media messages have no text to measure; their captions do count.
    if (message.text.length > 0) {
      allTexts.push(message.text);
      (textsPerParticipant[message.senderId] ??= []).push(message.text);
    }

    const date = message.localIso.slice(0, 10);
    dayCounts.set(date, (dayCounts.get(date) ?? 0) + 1);

    const month = message.localIso.slice(0, 7);
    const monthEntry = monthCounts.get(month) ?? { month, count: 0, perParticipant: {} };
    monthEntry.count += 1;
    monthEntry.perParticipant[message.senderId] =
      (monthEntry.perParticipant[message.senderId] ?? 0) + 1;
    monthCounts.set(month, monthEntry);

    const hour = Number(message.localIso.slice(11, 13));
    if (Number.isFinite(hour) && hour >= 0 && hour < 24) {
      byHour[hour] = (byHour[hour] ?? 0) + 1;
      const perPerson = byHourPerParticipant[message.senderId];
      if (perPerson) perPerson[hour] = (perPerson[hour] ?? 0) + 1;
    }

    // Weekday from the wall-clock date, index 0 = Monday.
    const weekdayIndex = weekdayFromIsoDate(date);
    if (weekdayIndex !== null) byWeekday[weekdayIndex] = (byWeekday[weekdayIndex] ?? 0) + 1;
  }

  const totalMessages = messages.length;
  const sharePerParticipant: Record<string, number> = {};
  for (const id of ids) {
    sharePerParticipant[id] =
      totalMessages > 0 ? round(((perParticipant[id] ?? 0) / totalMessages) * 100, 1) : 0;
  }

  const first = messages[0];
  const last = messages[messages.length - 1];
  const startDate = first ? first.localIso.slice(0, 10) : "";
  const endDate = last ? last.localIso.slice(0, 10) : "";
  const spanDays =
    first && last
      ? Math.max(1, Math.round((last.epochMs - first.epochMs) / 86_400_000) + 1)
      : 0;
  const activeDays = dayCounts.size;

  const lengthPerParticipant: Record<string, LengthStats> = {};
  for (const id of ids) lengthPerParticipant[id] = lengthStats(textsPerParticipant[id] ?? []);

  /* --- initiation ------------------------------------------------------- */

  const initiationCounts: Record<string, number> = {};
  for (const id of ids) initiationCounts[id] = 0;
  for (const segment of segments) {
    initiationCounts[segment.initiatorId] = (initiationCounts[segment.initiatorId] ?? 0) + 1;
  }
  const initiationShare: Record<string, number> = {};
  for (const id of ids) {
    initiationShare[id] =
      segments.length > 0
        ? round(((initiationCounts[id] ?? 0) / segments.length) * 100, 1)
        : 0;
  }

  /* --- response behaviour ---------------------------------------------- */

  const gapMs = gapMinutes * 60_000;
  const responsesPerParticipant: Record<string, number[]> = {};
  for (const id of ids) responsesPerParticipant[id] = [];
  const allResponses: number[] = [];
  let longestResponse: ConversationStatistics["response"]["longestResponse"] = null;
  let longestSilence: ConversationStatistics["response"]["longestSilence"] = null;

  for (let i = 1; i < messages.length; i += 1) {
    const previous = messages[i - 1]!;
    const current = messages[i]!;
    const deltaMs = current.epochMs - previous.epochMs;

    if (
      longestSilence === null ||
      deltaMs > longestSilence.seconds * 1000
    ) {
      longestSilence = {
        seconds: round(deltaMs / 1000, 0),
        fromIso: previous.localIso,
        toIso: current.localIso,
        brokenById: current.senderId,
      };
    }

    // Only a change of speaker inside the same conversation counts as a reply.
    if (current.senderId === previous.senderId) continue;
    if (deltaMs > gapMs) continue;

    const seconds = deltaMs / 1000;
    allResponses.push(seconds);
    (responsesPerParticipant[current.senderId] ??= []).push(seconds);

    if (longestResponse === null || seconds > longestResponse.seconds) {
      longestResponse = {
        seconds: round(seconds, 0),
        responderId: current.senderId,
        atIso: current.localIso,
      };
    }
  }

  const distribution: ResponseBucket[] = BUCKETS.map((bucket) => ({
    ...bucket,
    count: allResponses.filter(
      (seconds) =>
        seconds >= bucket.fromSeconds &&
        (bucket.toSeconds === null || seconds < bucket.toSeconds),
    ).length,
  }));

  const responsePerParticipant: Record<string, ResponseStats> = {};
  for (const id of ids) {
    responsePerParticipant[id] = summariseResponses(responsesPerParticipant[id] ?? []);
  }

  /* --- message characteristics ----------------------------------------- */

  const characteristics: Record<string, ParticipantCharacteristics> = {};
  for (const id of ids) {
    characteristics[id] = {
      messages: 0,
      questions: 0,
      questionRate: 0,
      exclamations: 0,
      exclamationRate: 0,
      messagesWithEmoji: 0,
      emojiRate: 0,
      totalEmoji: 0,
      links: 0,
      repeatedMessages: 0,
      maxConsecutiveMessages: 0,
      averageConsecutiveMessages: 0,
    };
  }

  const seenTexts: Record<string, Set<string>> = {};
  for (const id of ids) seenTexts[id] = new Set<string>();

  for (const message of messages) {
    const entry = characteristics[message.senderId];
    if (!entry) continue;
    entry.messages += 1;

    const text = message.text;
    if (text.length === 0) continue;

    if (QUESTION.test(text)) entry.questions += 1;
    if (EXCLAMATION.test(text)) entry.exclamations += 1;

    const emojiCount = countMatches(text, EMOJI);
    if (emojiCount > 0) {
      entry.messagesWithEmoji += 1;
      entry.totalEmoji += emojiCount;
    }

    const linkCount = countMatches(text, LINK);
    if (linkCount > 0) entry.links += 1;

    // "Repeated" means the exact same wording sent again by the same person.
    // Very short messages ("ok", "👍") repeat for uninteresting reasons.
    const normalised = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalised.length >= 8) {
      const seen = seenTexts[message.senderId]!;
      if (seen.has(normalised)) entry.repeatedMessages += 1;
      else seen.add(normalised);
    }
  }

  // Consecutive-message runs, measured inside a conversation only.
  const runsPerParticipant: Record<string, number[]> = {};
  for (const id of ids) runsPerParticipant[id] = [];
  for (const segment of segments) {
    let runSender = messages[segment.startIndex]!.senderId;
    let runLength = 0;
    for (let i = segment.startIndex; i <= segment.endIndex; i += 1) {
      const sender = messages[i]!.senderId;
      if (sender === runSender) {
        runLength += 1;
      } else {
        runsPerParticipant[runSender]?.push(runLength);
        runSender = sender;
        runLength = 1;
      }
    }
    runsPerParticipant[runSender]?.push(runLength);
  }

  for (const id of ids) {
    const entry = characteristics[id]!;
    const runs = runsPerParticipant[id] ?? [];
    entry.maxConsecutiveMessages = runs.length > 0 ? Math.max(...runs) : 0;
    entry.averageConsecutiveMessages = round(mean(runs), 2);
    entry.questionRate = entry.messages > 0 ? round((entry.questions / entry.messages) * 100, 1) : 0;
    entry.exclamationRate =
      entry.messages > 0 ? round((entry.exclamations / entry.messages) * 100, 1) : 0;
    entry.emojiRate =
      entry.messages > 0 ? round((entry.messagesWithEmoji / entry.messages) * 100, 1) : 0;
  }

  /* --- words ------------------------------------------------------------ */

  const wordTotals = new Map<string, number>();
  const wordPerParticipant: Record<string, Map<string, number>> = {};
  for (const id of ids) wordPerParticipant[id] = new Map<string, number>();
  const phraseTotals = new Map<string, number>();
  let totalWords = 0;

  for (const message of messages) {
    if (message.text.length === 0) continue;
    const withoutLinks = message.text.replace(LINK, " ");
    const tokens = tokenize(withoutLinks);
    totalWords += tokens.length;

    for (const token of tokens) {
      if (!isMeaningful(token)) continue;
      wordTotals.set(token, (wordTotals.get(token) ?? 0) + 1);
      const perPerson = wordPerParticipant[message.senderId];
      if (perPerson) perPerson.set(token, (perPerson.get(token) ?? 0) + 1);
    }

    // Bigrams are taken from the raw token stream so that removing stopwords
    // cannot glue together words that were never adjacent.
    for (let i = 1; i < tokens.length; i += 1) {
      const a = tokens[i - 1]!;
      const b = tokens[i]!;
      if (!isMeaningful(a) || !isMeaningful(b)) continue;
      const phrase = `${a} ${b}`;
      phraseTotals.set(phrase, (phraseTotals.get(phrase) ?? 0) + 1);
    }
  }

  const meaningfulTotal = [...wordTotals.values()].reduce((sum, value) => sum + value, 0);
  const toWordCounts = (source: Map<string, number>, limit: number): WordCount[] =>
    [...source.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([word, count]) => ({
        word,
        count,
        share: meaningfulTotal > 0 ? round((count / meaningfulTotal) * 100, 2) : 0,
      }));

  const topPerParticipant: Record<string, WordCount[]> = {};
  for (const id of ids) {
    topPerParticipant[id] = toWordCounts(wordPerParticipant[id] ?? new Map(), 12);
  }

  const phrases: PhraseCount[] = [...phraseTotals.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([phrase, count]) => ({ phrase, count }));

  /* --- time series ------------------------------------------------------ */

  const daily: DailyPoint[] = [...dayCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  const monthly: MonthlyPoint[] = [...monthCounts.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );

  const busiestHour = byHour.some((value) => value > 0)
    ? byHour.indexOf(Math.max(...byHour))
    : null;
  const busiestWeekday = byWeekday.some((value) => value > 0)
    ? byWeekday.indexOf(Math.max(...byWeekday))
    : null;

  const statistics: ConversationStatistics = {
    meta: {
      computedAt: new Date().toISOString(),
      messagesAnalysed: totalMessages,
      mediaMessages: conversation.counts.withMedia,
      timezoneOffsetMinutes: conversation.timezoneOffsetMinutes,
      conversationGapMinutes: gapMinutes,
    },
    participants,
    general: {
      totalMessages,
      perParticipant,
      sharePerParticipant,
      dateRange: { start: startDate, end: endDate, spanDays },
      activeDays,
      averageMessagesPerDay: spanDays > 0 ? round(totalMessages / spanDays, 1) : 0,
      averageMessagesPerActiveDay: activeDays > 0 ? round(totalMessages / activeDays, 1) : 0,
      length: lengthStats(allTexts),
      lengthPerParticipant,
    },
    initiation: {
      algorithm: segmentationDescription(gapMinutes),
      totalConversations: segments.length,
      perParticipant: initiationCounts,
      sharePerParticipant: initiationShare,
      averageMessagesPerConversation:
        segments.length > 0 ? round(totalMessages / segments.length, 1) : 0,
    },
    response: {
      algorithm:
        "A response time is the gap between the last message of one person and the first reply from the other, measured only inside a single conversation. Gaps that cross a conversation boundary are excluded so that overnight silences are not counted as slow replies.",
      overall: summariseResponses(allResponses),
      perParticipant: responsePerParticipant,
      distribution,
      longestResponse,
      longestSilence,
    },
    characteristics: {
      perParticipant: characteristics,
      totalQuestions: ids.reduce((sum, id) => sum + (characteristics[id]?.questions ?? 0), 0),
      totalLinks: ids.reduce((sum, id) => sum + (characteristics[id]?.links ?? 0), 0),
      totalEmoji: ids.reduce((sum, id) => sum + (characteristics[id]?.totalEmoji ?? 0), 0),
    },
    time: {
      byHour,
      byHourPerParticipant,
      byWeekday,
      daily,
      monthly,
      busiestHour,
      busiestWeekday,
    },
    words: {
      totalWords,
      uniqueWords: wordTotals.size,
      top: toWordCounts(wordTotals, topWords),
      topPerParticipant,
      phrases,
    },
  };

  return { statistics, segments };
}

/** Index 0 = Monday, from a `YYYY-MM-DD` wall-clock date. */
function weekdayFromIsoDate(date: string): number | null {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  // getUTCDay: 0 = Sunday.
  return (new Date(ms).getUTCDay() + 6) % 7;
}

export const WEEKDAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** Message types excluded from the statistics, exported for documentation. */
export const EXCLUDED_TYPES = [MessageType.SYSTEM, MessageType.CALL, MessageType.UNKNOWN];
