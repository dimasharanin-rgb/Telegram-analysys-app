/**
 * The second layer of deterministic statistics, added in V2.
 *
 * Everything here is arithmetic over the full message set: interaction
 * balance, double texting, unanswered messages, vocabulary breadth, emotional
 * language indicators, period-over-period change, and a shortlist of exchanges
 * that look like disagreements.
 *
 * The conflict shortlist is the important one for cost: rather than asking a
 * model to read the whole conversation hunting for arguments, the scoring here
 * nominates a handful of candidate exchanges and the model is asked about
 * those. The scoring is a heuristic and is labelled as one everywhere it
 * surfaces.
 */

import type { ConversationSegment } from "@/lib/analysis/segmentation";
import type { Conversation, NormalizedMessage } from "@/lib/model/message";
import { tokenize } from "./index";
import {
  addCounts,
  emptyIndicatorCounts,
  scoreMessage,
  type IndicatorCounts,
} from "./lexicon";

/* -------------------------------------------------------------------------
 * Shapes
 * ---------------------------------------------------------------------- */

export interface ParticipantInteractionStats {
  /** Messages sent within the follow-up window while still unanswered. */
  doubleTexts: number;
  /** Runs of three or more consecutive messages. */
  bursts: number;
  longestRun: number;
  /** Conversations this person ended with no reply from the other side. */
  unansweredEndings: number;
  questionsAsked: number;
  questionsAnswered: number;
  questionAnswerRate: number;
  vocabularySize: number;
  /** Type-token ratio over a fixed-size sample, so lengths are comparable. */
  vocabularyDiversity: number;
  averageWordsPerMessage: number;
}

export interface ReciprocityStats {
  /** 0-1, where 1 is a perfectly even split. */
  messageBalance: number;
  initiationBalance: number;
  lengthBalance: number;
  /** Slower median reply divided by the faster one; 1 means identical. */
  responseTimeRatio: number;
  /** Speaker changes across the whole conversation. */
  turns: number;
  averageTurnsPerConversation: number;
}

export interface EmotionalStats {
  perParticipant: Record<string, IndicatorCounts>;
  overall: IndicatorCounts;
  /** Messages examined, so counts can be read as a share. */
  messagesScored: number;
}

export interface PeriodStatistics {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  messages: number;
  perParticipant: Record<string, number>;
  averageLength: number;
  medianResponseSeconds: number;
  initiationShare: Record<string, number>;
  questionRate: number;
  emojiRate: number;
  conversations: number;
  averageMessagesPerConversation: number;
  indicators: IndicatorCounts;
  topWords: string[];
}

export interface TimelineChange {
  metric: string;
  label: string;
  early: number;
  recent: number;
  direction: "up" | "down" | "flat";
  changePercent: number;
  /** Formatted for display, since units differ per metric. */
  earlyLabel: string;
  recentLabel: string;
}

export interface ConflictCandidate {
  id: string;
  segmentIndex: number;
  startIso: string;
  endIso: string;
  messageIds: string[];
  /** Relative score; only useful for ranking, never shown as a percentage. */
  score: number;
  signals: string[];
  /** Silence immediately after the exchange, in seconds. */
  followedBySilenceSeconds: number;
  repairFollowed: boolean;
}

export interface AdvancedStatistics {
  interaction: {
    perParticipant: Record<string, ParticipantInteractionStats>;
    reciprocity: ReciprocityStats;
  };
  emotional: EmotionalStats;
  timeline: {
    periods: PeriodStatistics[];
    changes: TimelineChange[];
    /** False when there is not enough history to compare periods honestly. */
    comparable: boolean;
    note: string;
  };
  conflictCandidates: ConflictCandidate[];
  methodology: string[];
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

const DOUBLE_TEXT_WINDOW_MS = 10 * 60 * 1000;
const BURST_MIN = 3;
const VOCABULARY_SAMPLE = 2_000;
const MAX_CONFLICT_CANDIDATES = 8;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** 1 when the two largest shares are equal, 0 when one side has everything. */
function balance(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0 || values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  const top = sorted[0]! / total;
  return round(Math.max(0, 1 - (top - 0.5) * 2), 3);
}

function emptyInteraction(): ParticipantInteractionStats {
  return {
    doubleTexts: 0,
    bursts: 0,
    longestRun: 0,
    unansweredEndings: 0,
    questionsAsked: 0,
    questionsAnswered: 0,
    questionAnswerRate: 0,
    vocabularySize: 0,
    vocabularyDiversity: 0,
    averageWordsPerMessage: 0,
  };
}

const EMOJI = /\p{Extended_Pictographic}/u;

/* -------------------------------------------------------------------------
 * Entry point
 * ---------------------------------------------------------------------- */

export interface AdvancedOptions {
  conversationGapMinutes: number;
  /** Median reply time per participant, from the base statistics. */
  medianResponseSeconds?: Record<string, number>;
}

export function computeAdvancedStatistics(
  conversation: Conversation,
  segments: readonly ConversationSegment[],
  options: AdvancedOptions,
): AdvancedStatistics {
  const messages = conversation.messages;
  const ids = conversation.participants.map((participant) => participant.id);

  const interaction = computeInteraction(messages, segments, ids, options);
  const emotional = computeEmotional(messages, ids);
  const timeline = computeTimeline(messages, segments, ids, options);
  const conflictCandidates = detectConflictCandidates(messages, segments);

  return {
    interaction,
    emotional,
    timeline,
    conflictCandidates,
    methodology: [
      `A double text is a message sent while the previous message was also yours and no reply had arrived within ${DOUBLE_TEXT_WINDOW_MS / 60000} minutes.`,
      "An unanswered ending is a conversation whose final message was yours, so nothing came back before the conversation stopped.",
      `A burst is a run of ${BURST_MIN} or more consecutive messages from one person.`,
      "A question counts as answered when the other person replied inside the same conversation before the topic moved on.",
      `Vocabulary diversity is the ratio of distinct words to total words over the first ${VOCABULARY_SAMPLE.toLocaleString("en-US")} meaningful words from each person, so people who wrote more are not penalised.`,
      "Emotional language indicators count how many messages contain a word from a fixed list. They are word counts, not a measure of how anyone felt.",
      "Difficult moments are shortlisted by a scoring heuristic over wording, pacing and the silence that follows. It nominates exchanges to look at; it does not decide that an argument happened.",
    ],
  };
}

/* -------------------------------------------------------------------------
 * Interaction
 * ---------------------------------------------------------------------- */

function computeInteraction(
  messages: readonly NormalizedMessage[],
  segments: readonly ConversationSegment[],
  ids: string[],
  options: AdvancedOptions,
): AdvancedStatistics["interaction"] {
  const perParticipant: Record<string, ParticipantInteractionStats> = {};
  const vocabulary: Record<string, { seen: Set<string>; sampled: number }> = {};
  const wordCounts: Record<string, { words: number; messages: number }> = {};
  const messageCounts: Record<string, number> = {};
  const lengthTotals: Record<string, number> = {};

  for (const id of ids) {
    perParticipant[id] = emptyInteraction();
    vocabulary[id] = { seen: new Set(), sampled: 0 };
    wordCounts[id] = { words: 0, messages: 0 };
    messageCounts[id] = 0;
    lengthTotals[id] = 0;
  }

  let turns = 0;
  let previousSender: string | null = null;

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]!;
    const entry = perParticipant[message.senderId];
    if (!entry) continue;

    messageCounts[message.senderId] = (messageCounts[message.senderId] ?? 0) + 1;
    lengthTotals[message.senderId] =
      (lengthTotals[message.senderId] ?? 0) + message.text.length;

    if (previousSender !== null && previousSender !== message.senderId) turns += 1;
    previousSender = message.senderId;

    if (message.text.length > 0) {
      const tokens = tokenize(message.text);
      const counter = wordCounts[message.senderId]!;
      counter.words += tokens.length;
      counter.messages += 1;

      const vocab = vocabulary[message.senderId]!;
      for (const token of tokens) {
        if (vocab.sampled >= VOCABULARY_SAMPLE) break;
        if (token.length < 3) continue;
        vocab.seen.add(token);
        vocab.sampled += 1;
      }

      if (message.text.includes("?")) entry.questionsAsked += 1;
    }

    // Double texting: previous message was also mine and nothing came back.
    const previous = messages[i - 1];
    if (
      previous &&
      previous.senderId === message.senderId &&
      message.epochMs - previous.epochMs <= DOUBLE_TEXT_WINDOW_MS
    ) {
      entry.doubleTexts += 1;
    }
  }

  // Runs and question answering are per-conversation properties.
  for (const segment of segments) {
    let runSender = messages[segment.startIndex]!.senderId;
    let runLength = 0;

    for (let i = segment.startIndex; i <= segment.endIndex; i += 1) {
      const message = messages[i]!;

      if (message.senderId === runSender) {
        runLength += 1;
      } else {
        recordRun(perParticipant[runSender], runLength);
        runSender = message.senderId;
        runLength = 1;
      }

      if (message.text.includes("?")) {
        const answered = messages
          .slice(i + 1, Math.min(segment.endIndex + 1, i + 6))
          .some((later) => later.senderId !== message.senderId);
        if (answered) {
          const entry = perParticipant[message.senderId];
          if (entry) entry.questionsAnswered += 1;
        }
      }
    }
    recordRun(perParticipant[runSender], runLength);

    // Whoever sent the final message of a conversation did not get a reply to
    // it. Only counted when the other side actually took part, so a one-sided
    // conversation is not scored as being ignored.
    const last = messages[segment.endIndex]!;
    if (segment.participantIds.length > 1) {
      const entry = perParticipant[last.senderId];
      if (entry) entry.unansweredEndings += 1;
    }
  }

  for (const id of ids) {
    const entry = perParticipant[id]!;
    const vocab = vocabulary[id]!;
    const counter = wordCounts[id]!;
    entry.vocabularySize = vocab.seen.size;
    entry.vocabularyDiversity =
      vocab.sampled > 0 ? round(vocab.seen.size / vocab.sampled, 3) : 0;
    entry.averageWordsPerMessage =
      counter.messages > 0 ? round(counter.words / counter.messages, 1) : 0;
    entry.questionAnswerRate =
      entry.questionsAsked > 0
        ? round((entry.questionsAnswered / entry.questionsAsked) * 100, 1)
        : 0;
  }

  const averageLengths = ids.map((id) =>
    (messageCounts[id] ?? 0) > 0 ? (lengthTotals[id] ?? 0) / (messageCounts[id] ?? 1) : 0,
  );

  const initiationCounts: Record<string, number> = {};
  for (const id of ids) initiationCounts[id] = 0;
  for (const segment of segments) {
    initiationCounts[segment.initiatorId] = (initiationCounts[segment.initiatorId] ?? 0) + 1;
  }

  return {
    perParticipant,
    reciprocity: {
      messageBalance: balance(ids.map((id) => messageCounts[id] ?? 0)),
      initiationBalance: balance(ids.map((id) => initiationCounts[id] ?? 0)),
      lengthBalance: balance(averageLengths),
      responseTimeRatio: responseRatio(ids, options.medianResponseSeconds),
      turns,
      averageTurnsPerConversation:
        segments.length > 0 ? round(turns / segments.length, 1) : 0,
    },
  };
}

/** Slower median divided by the faster one; 1 means the two are identical. */
function responseRatio(
  ids: string[],
  medians: Record<string, number> | undefined,
): number {
  if (!medians) return 0;
  const values = ids.map((id) => medians[id] ?? 0).filter((value) => value > 0);
  if (values.length < 2) return 0;
  const fastest = Math.min(...values);
  const slowest = Math.max(...values);
  return fastest > 0 ? round(slowest / fastest, 2) : 0;
}

function recordRun(entry: ParticipantInteractionStats | undefined, length: number): void {
  if (!entry || length <= 0) return;
  if (length >= BURST_MIN) entry.bursts += 1;
  if (length > entry.longestRun) entry.longestRun = length;
}

/* -------------------------------------------------------------------------
 * Emotional language
 * ---------------------------------------------------------------------- */

function computeEmotional(
  messages: readonly NormalizedMessage[],
  ids: string[],
): EmotionalStats {
  const perParticipant: Record<string, IndicatorCounts> = {};
  for (const id of ids) perParticipant[id] = emptyIndicatorCounts();
  const overall = emptyIndicatorCounts();
  let scored = 0;

  for (const message of messages) {
    if (message.text.length === 0) continue;
    const counts = scoreMessage(message.text, tokenize(message.text));
    const target = perParticipant[message.senderId];
    if (target) addCounts(target, counts);
    addCounts(overall, counts);
    scored += 1;
  }

  return { perParticipant, overall, messagesScored: scored };
}

/* -------------------------------------------------------------------------
 * Timeline
 * ---------------------------------------------------------------------- */

const MIN_MESSAGES_FOR_PERIODS = 150;
const MIN_DAYS_FOR_PERIODS = 45;

function computeTimeline(
  messages: readonly NormalizedMessage[],
  segments: readonly ConversationSegment[],
  ids: string[],
  options: AdvancedOptions,
): AdvancedStatistics["timeline"] {
  const first = messages[0];
  const last = messages[messages.length - 1];
  if (!first || !last) {
    return { periods: [], changes: [], comparable: false, note: "No messages." };
  }

  const spanDays = Math.max(
    1,
    Math.round((last.epochMs - first.epochMs) / 86_400_000) + 1,
  );

  if (messages.length < MIN_MESSAGES_FOR_PERIODS || spanDays < MIN_DAYS_FOR_PERIODS) {
    return {
      periods: [
        buildPeriod("whole", "Whole conversation", messages, segments, ids, options),
      ],
      changes: [],
      comparable: false,
      note: `Comparing periods needs at least ${MIN_MESSAGES_FOR_PERIODS} messages across ${MIN_DAYS_FOR_PERIODS} days. This conversation has ${messages.length} across ${spanDays}.`,
    };
  }

  // Equal thirds by message count, so every period rests on the same amount of
  // evidence even when the conversation sped up or slowed down.
  const third = Math.floor(messages.length / 3);
  const slices: { id: string; label: string; from: number; to: number }[] = [
    { id: "early", label: "Early period", from: 0, to: third },
    { id: "middle", label: "Middle period", from: third, to: third * 2 },
    { id: "recent", label: "Recent period", from: third * 2, to: messages.length },
  ];

  const periods = slices.map((slice) =>
    buildPeriod(
      slice.id,
      slice.label,
      messages.slice(slice.from, slice.to),
      segmentsWithin(segments, slice.from, slice.to),
      ids,
      options,
    ),
  );

  const early = periods[0]!;
  const recent = periods[periods.length - 1]!;

  return {
    periods,
    changes: compareperiods(early, recent, ids),
    comparable: true,
    note: "Periods are equal thirds by message count, so each rests on the same amount of evidence.",
  };
}

function segmentsWithin(
  segments: readonly ConversationSegment[],
  from: number,
  to: number,
): ConversationSegment[] {
  return segments.filter(
    (segment) => segment.startIndex >= from && segment.startIndex < to,
  );
}

function buildPeriod(
  id: string,
  label: string,
  messages: readonly NormalizedMessage[],
  segments: readonly ConversationSegment[],
  ids: string[],
  options: AdvancedOptions,
): PeriodStatistics {
  const perParticipant: Record<string, number> = {};
  const initiation: Record<string, number> = {};
  for (const participantId of ids) {
    perParticipant[participantId] = 0;
    initiation[participantId] = 0;
  }

  const indicators = emptyIndicatorCounts();
  const wordCounts = new Map<string, number>();
  let lengthTotal = 0;
  let textMessages = 0;
  let questions = 0;
  let emoji = 0;
  const responses: number[] = [];
  const gapMs = options.conversationGapMinutes * 60_000;

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]!;
    perParticipant[message.senderId] = (perParticipant[message.senderId] ?? 0) + 1;

    if (message.text.length > 0) {
      lengthTotal += message.text.length;
      textMessages += 1;
      if (message.text.includes("?")) questions += 1;
      if (EMOJI.test(message.text)) emoji += 1;

      const tokens = tokenize(message.text);
      addCounts(indicators, scoreMessage(message.text, tokens));
      for (const token of tokens) {
        if (token.length < 4) continue;
        wordCounts.set(token, (wordCounts.get(token) ?? 0) + 1);
      }
    }

    const previous = messages[i - 1];
    if (
      previous &&
      previous.senderId !== message.senderId &&
      message.epochMs - previous.epochMs <= gapMs
    ) {
      responses.push((message.epochMs - previous.epochMs) / 1000);
    }
  }

  for (const segment of segments) {
    initiation[segment.initiatorId] = (initiation[segment.initiatorId] ?? 0) + 1;
  }

  const initiationShare: Record<string, number> = {};
  const totalSegments = segments.length || 1;
  for (const participantId of ids) {
    initiationShare[participantId] = round(
      ((initiation[participantId] ?? 0) / totalSegments) * 100,
      1,
    );
  }

  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];

  return {
    id,
    label,
    startDate: firstMessage ? firstMessage.localIso.slice(0, 10) : "",
    endDate: lastMessage ? lastMessage.localIso.slice(0, 10) : "",
    messages: messages.length,
    perParticipant,
    averageLength: textMessages > 0 ? round(lengthTotal / textMessages, 1) : 0,
    medianResponseSeconds: round(median(responses), 0),
    initiationShare,
    questionRate: messages.length > 0 ? round((questions / messages.length) * 100, 1) : 0,
    emojiRate: messages.length > 0 ? round((emoji / messages.length) * 100, 1) : 0,
    conversations: segments.length,
    averageMessagesPerConversation:
      segments.length > 0 ? round(messages.length / segments.length, 1) : 0,
    indicators,
    topWords: [...wordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word),
  };
}

function direction(early: number, recent: number): TimelineChange["direction"] {
  if (early === 0 && recent === 0) return "flat";
  const change = early === 0 ? 1 : (recent - early) / early;
  if (Math.abs(change) < 0.1) return "flat";
  return change > 0 ? "up" : "down";
}

function percentChange(early: number, recent: number): number {
  if (early === 0) return recent === 0 ? 0 : 100;
  return round(((recent - early) / early) * 100, 1);
}

function compareperiods(
  early: PeriodStatistics,
  recent: PeriodStatistics,
  ids: string[],
): TimelineChange[] {
  const changes: TimelineChange[] = [
    metric("averageLength", "Average message length", early.averageLength, recent.averageLength, (v) => `${Math.round(v)} chars`),
    metric("medianResponse", "Median reply time", early.medianResponseSeconds, recent.medianResponseSeconds, formatSeconds),
    metric("questionRate", "Messages containing a question", early.questionRate, recent.questionRate, (v) => `${v}%`),
    metric("emojiRate", "Messages containing emoji", early.emojiRate, recent.emojiRate, (v) => `${v}%`),
    metric("conversationLength", "Messages per conversation", early.averageMessagesPerConversation, recent.averageMessagesPerConversation, (v) => `${v}`),
    metric("tension", "Messages with tension wording", early.indicators.tension, recent.indicators.tension, (v) => `${v} messages`),
    metric("warmth", "Messages with warmth wording", early.indicators.warmth, recent.indicators.warmth, (v) => `${v} messages`),
    metric("apology", "Messages containing an apology", early.indicators.apology, recent.indicators.apology, (v) => `${v} messages`),
  ];

  // Initiation balance shift for the most active participant.
  const firstId = ids[0];
  if (firstId) {
    changes.push(
      metric(
        "initiation",
        "Share of conversations started",
        early.initiationShare[firstId] ?? 0,
        recent.initiationShare[firstId] ?? 0,
        (v) => `${v}%`,
      ),
    );
  }

  return changes;
}

function metric(
  id: string,
  label: string,
  early: number,
  recent: number,
  format: (value: number) => string,
): TimelineChange {
  return {
    metric: id,
    label,
    early,
    recent,
    direction: direction(early, recent),
    changePercent: percentChange(early, recent),
    earlyLabel: format(early),
    recentLabel: format(recent),
  };
}

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} hr`;
}

/* -------------------------------------------------------------------------
 * Conflict candidates
 * ---------------------------------------------------------------------- */

function detectConflictCandidates(
  messages: readonly NormalizedMessage[],
  segments: readonly ConversationSegment[],
): ConflictCandidate[] {
  const candidates: ConflictCandidate[] = [];

  for (const segment of segments) {
    if (segment.messageCount < 4 || segment.participantIds.length < 2) continue;

    const window = messages.slice(
      segment.startIndex,
      Math.min(segment.endIndex + 1, segment.startIndex + 80),
    );

    let tension = 0;
    let absolutes = 0;
    let apology = 0;
    let longMessages = 0;
    let questionRuns = 0;

    for (const message of window) {
      if (message.text.length === 0) continue;
      const counts = scoreMessage(message.text, tokenize(message.text));
      tension += counts.tension;
      absolutes += counts.absolutes;
      apology += counts.apology;
      if (message.text.length > 220) longMessages += 1;
      if (message.text.includes("?")) questionRuns += 1;
    }

    if (tension === 0 && absolutes === 0) continue;

    // Silence immediately after the exchange is a strong signal that it ended
    // badly rather than simply ending.
    const next = messages[segment.endIndex + 1];
    const silence = next
      ? (next.epochMs - messages[segment.endIndex]!.epochMs) / 1000
      : 0;

    // Repair afterwards: an apology in the first few messages of the next
    // conversation.
    const repairFollowed = messages
      .slice(segment.endIndex + 1, segment.endIndex + 8)
      .some(
        (message) =>
          message.text.length > 0 &&
          scoreMessage(message.text, tokenize(message.text)).apology > 0,
      );

    const signals: string[] = [];
    if (tension >= 2) signals.push(`${tension} messages with tension wording`);
    if (absolutes >= 2) signals.push(`${absolutes} messages with absolute wording`);
    if (longMessages >= 2) signals.push(`${longMessages} unusually long messages`);
    if (silence > 6 * 3600) signals.push("a long silence immediately afterwards");
    if (apology > 0) signals.push(`${apology} messages containing an apology`);
    if (repairFollowed) signals.push("an apology in the next conversation");

    const score =
      tension * 3 +
      absolutes * 2 +
      longMessages * 1.5 +
      (silence > 6 * 3600 ? 4 : 0) +
      (repairFollowed ? 3 : 0) +
      Math.min(questionRuns, 4);

    candidates.push({
      id: `cf${segment.index}`,
      segmentIndex: segment.index,
      startIso: segment.startIso,
      endIso: segment.endIso,
      messageIds: window.map((message) => message.id),
      score: round(score, 1),
      signals,
      followedBySilenceSeconds: Math.round(silence),
      repairFollowed,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CONFLICT_CANDIDATES)
    .sort((a, b) => a.startIso.localeCompare(b.startIso));
}
