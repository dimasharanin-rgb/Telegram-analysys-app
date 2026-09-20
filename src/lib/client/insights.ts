/**
 * Turns statistics + AI analysis into an ordered deck of flashcards.
 *
 * The deck deliberately opens with cards built from the local statistics -
 * those are arithmetic, not interpretation - and only then moves into the AI
 * patterns. Every card states which of the two it is, so "68% of conversations
 * were started by you" is never presented in the same voice as "one reading of
 * this is…".
 */

import type { Analysis, Confidence, Evidence, InsightCategory } from "@/lib/ai/schema";
import type { ConversationStatistics } from "@/lib/stats";
import { humanise, type PseudonymMap } from "@/lib/pipeline/payload";
import { formatDuration, formatNumber } from "./format";

export type CardKind =
  | "overview"
  | "measured"
  | "pattern"
  | "strength"
  | "watchout"
  | "suggestion"
  | "topic";

export interface InsightCardModel {
  id: string;
  kind: CardKind;
  category: InsightCategory;
  categoryLabel: string;
  title: string;
  /** Big number treatment, when the card is built around one figure. */
  headline?: { value: string; caption: string };
  /** What is literally in the conversation. */
  observation?: string;
  /** What it might mean. Always labelled as interpretation in the UI. */
  interpretation?: string;
  /** Why the reading is uncertain. */
  uncertainty?: string;
  /** Free text for cards that are not observation/interpretation shaped. */
  body?: string;
  suggestion?: { do: string; avoid: string };
  evidence: Evidence[];
  confidence?: Confidence;
  /** True when the card's numbers come from local arithmetic. */
  measured: boolean;
}

export const CATEGORY_LABELS: Record<InsightCategory, string> = {
  communication: "Communication",
  "response-patterns": "Response patterns",
  "conversation-dynamics": "Conversation dynamics",
  "recurring-topics": "Recurring topics",
  "positive-patterns": "Positive patterns",
  "things-to-watch": "Things to watch",
};

/** Cards shown before the user asks for the rest. */
export const PRIMARY_DECK_SIZE = 12;

interface BuildOptions {
  statistics: ConversationStatistics;
  analysis: Analysis;
  pseudonyms: PseudonymMap;
}

function name(
  statistics: ConversationStatistics,
  participantId: string,
): string {
  return (
    statistics.participants.find((participant) => participant.id === participantId)?.name ??
    "Someone"
  );
}

/**
 * Deterministic cards. These are the ones that can carry a big number,
 * because the number is arithmetic rather than a model's estimate.
 */
function measuredCards(statistics: ConversationStatistics): InsightCardModel[] {
  const cards: InsightCardModel[] = [];
  const participants = statistics.participants;
  if (participants.length === 0) return cards;

  // Who starts conversations.
  const byInitiation = [...participants].sort(
    (a, b) =>
      (statistics.initiation.sharePerParticipant[b.id] ?? 0) -
      (statistics.initiation.sharePerParticipant[a.id] ?? 0),
  );
  const topInitiator = byInitiation[0];
  if (topInitiator && statistics.initiation.totalConversations > 0) {
    const share = statistics.initiation.sharePerParticipant[topInitiator.id] ?? 0;
    cards.push({
      id: "measured-initiation",
      kind: "measured",
      category: "conversation-dynamics",
      categoryLabel: CATEGORY_LABELS["conversation-dynamics"],
      title:
        share >= 60
          ? `${topInitiator.name} starts most conversations`
          : "Conversations start fairly evenly",
      headline: {
        value: `${share}%`,
        caption: `of ${formatNumber(statistics.initiation.totalConversations)} detected conversations were started by ${topInitiator.name}`,
      },
      observation: statistics.initiation.algorithm,
      uncertainty:
        "A difference in who sends the first message does not by itself explain why. Schedules, time zones and habits all produce the same number.",
      evidence: [],
      measured: true,
    });
  }

  // Who talks more.
  const byShare = [...participants].sort(
    (a, b) =>
      (statistics.general.sharePerParticipant[b.id] ?? 0) -
      (statistics.general.sharePerParticipant[a.id] ?? 0),
  );
  const top = byShare[0];
  const second = byShare[1];
  if (top && second) {
    const topShare = statistics.general.sharePerParticipant[top.id] ?? 0;
    const gap = topShare - (statistics.general.sharePerParticipant[second.id] ?? 0);
    cards.push({
      id: "measured-share",
      kind: "measured",
      category: "communication",
      categoryLabel: CATEGORY_LABELS.communication,
      title:
        gap < 10
          ? "Message volume is close to even"
          : `${top.name} sends more of the messages`,
      headline: {
        value: `${topShare}%`,
        caption: `of ${formatNumber(statistics.general.totalMessages)} messages were sent by ${top.name}`,
      },
      observation: `${top.name} sent ${formatNumber(statistics.general.perParticipant[top.id] ?? 0)} messages and ${second.name} sent ${formatNumber(statistics.general.perParticipant[second.id] ?? 0)}. Average message length is ${Math.round(statistics.general.lengthPerParticipant[top.id]?.averageCharacters ?? 0)} characters for ${top.name} and ${Math.round(statistics.general.lengthPerParticipant[second.id]?.averageCharacters ?? 0)} for ${second.name}.`,
      uncertainty:
        "Message count is not the same as how much someone says: one person may write long messages, the other may split a thought across several.",
      evidence: [],
      measured: true,
    });
  }

  // Response speed.
  const withResponses = participants.filter(
    (participant) => (statistics.response.perParticipant[participant.id]?.count ?? 0) >= 5,
  );
  if (withResponses.length >= 2) {
    const sorted = [...withResponses].sort(
      (a, b) =>
        (statistics.response.perParticipant[a.id]?.medianSeconds ?? 0) -
        (statistics.response.perParticipant[b.id]?.medianSeconds ?? 0),
    );
    const fastest = sorted[0]!;
    const slowest = sorted[sorted.length - 1]!;
    const fastMedian = statistics.response.perParticipant[fastest.id]?.medianSeconds ?? 0;
    const slowMedian = statistics.response.perParticipant[slowest.id]?.medianSeconds ?? 0;

    cards.push({
      id: "measured-response",
      kind: "measured",
      category: "response-patterns",
      categoryLabel: CATEGORY_LABELS["response-patterns"],
      title:
        slowMedian > fastMedian * 2
          ? `${fastest.name} replies faster`
          : "Reply speed is similar on both sides",
      headline: {
        value: formatDuration(fastMedian),
        caption: `median reply from ${fastest.name}, against ${formatDuration(slowMedian)} from ${slowest.name}`,
      },
      observation: statistics.response.algorithm,
      uncertainty:
        "Median reply time measures availability as much as attention. It says nothing about what someone was doing in between.",
      evidence: [],
      measured: true,
    });
  }

  return cards;
}

export function buildInsightDeck(options: BuildOptions): InsightCardModel[] {
  const { statistics, analysis, pseudonyms } = options;
  const text = (value: string) => humanise(value, pseudonyms.toDisplayName);
  const cards: InsightCardModel[] = [];

  cards.push({
    id: "overview",
    kind: "overview",
    category: "communication",
    categoryLabel: "Overview",
    title: "What this conversation looks like",
    body: text(analysis.overview.summary),
    evidence: [],
    confidence: analysis.overview.confidence,
    measured: false,
  });

  cards.push(...measuredCards(statistics));

  analysis.patterns.forEach((pattern, index) => {
    cards.push({
      id: `pattern-${index}`,
      kind: "pattern",
      category: pattern.category,
      categoryLabel: CATEGORY_LABELS[pattern.category],
      title: text(pattern.title),
      observation: text(pattern.observation),
      interpretation: text(pattern.interpretation),
      uncertainty: text(pattern.uncertainty),
      evidence: pattern.evidence,
      confidence: pattern.confidence,
      measured: false,
    });
  });

  analysis.strengths.forEach((item, index) => {
    cards.push({
      id: `strength-${index}`,
      kind: "strength",
      category: "positive-patterns",
      categoryLabel: CATEGORY_LABELS["positive-patterns"],
      title: text(item.title),
      body: text(item.description),
      evidence: item.evidence,
      measured: false,
    });
  });

  analysis.watchouts.forEach((item, index) => {
    cards.push({
      id: `watchout-${index}`,
      kind: "watchout",
      category: "things-to-watch",
      categoryLabel: CATEGORY_LABELS["things-to-watch"],
      title: text(item.title),
      body: text(item.description),
      evidence: item.evidence,
      measured: false,
    });
  });

  analysis.recurringTopics.forEach((item, index) => {
    cards.push({
      id: `topic-${index}`,
      kind: "topic",
      category: "recurring-topics",
      categoryLabel: CATEGORY_LABELS["recurring-topics"],
      title: text(item.topic),
      headline: item.frequency ? { value: text(item.frequency), caption: "" } : undefined,
      body: text(item.description),
      evidence: [],
      measured: false,
    });
  });

  analysis.suggestions.forEach((item, index) => {
    cards.push({
      id: `suggestion-${index}`,
      kind: "suggestion",
      category: "communication",
      categoryLabel: "Suggestion",
      title: text(item.title),
      body: text(item.description),
      suggestion: { do: text(item.do), avoid: text(item.avoid) },
      evidence: [],
      measured: false,
    });
  });

  return cards;
}

/**
 * Ordering for the deck the user sees first: overview, the measured facts,
 * then interpretation, and practical suggestions last.
 */
const KIND_PRIORITY: Record<CardKind, number> = {
  overview: 0,
  measured: 1,
  pattern: 2,
  strength: 3,
  watchout: 4,
  topic: 5,
  suggestion: 6,
};

const CONFIDENCE_PRIORITY: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

export function prioritiseDeck(cards: InsightCardModel[]): {
  primary: InsightCardModel[];
  extra: InsightCardModel[];
} {
  const ordered = [...cards].sort((a, b) => {
    const byKind = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
    if (byKind !== 0) return byKind;
    const aConfidence = a.confidence ? CONFIDENCE_PRIORITY[a.confidence] : 1;
    const bConfidence = b.confidence ? CONFIDENCE_PRIORITY[b.confidence] : 1;
    if (aConfidence !== bConfidence) return aConfidence - bConfidence;
    // Cards backed by evidence come before ones that only assert.
    return b.evidence.length - a.evidence.length;
  });

  return {
    primary: ordered.slice(0, PRIMARY_DECK_SIZE),
    extra: ordered.slice(PRIMARY_DECK_SIZE),
  };
}

export { name as participantName };
