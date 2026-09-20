/**
 * Excerpt selection.
 *
 * The raw export is never sent anywhere. This module decides which parts of
 * the conversation are worth a model's attention, and reduces them to the
 * smallest representation that still reads like a conversation:
 *
 *   - whole segments, so exchanges keep their back-and-forth,
 *   - spread across the timeline, so one busy month cannot stand in for a year,
 *   - ranked by how much actual dialogue they contain,
 *   - truncated per message and capped by a global character budget.
 *
 * Message ids are preserved so that every claim the model makes can be linked
 * back to real messages held locally in the browser.
 */

import type { ConversationSegment } from "@/lib/analysis/segmentation";
import { MessageType, type NormalizedMessage } from "@/lib/model/message";
import type { Excerpt, ExcerptMessage } from "@/lib/ai/schema";

const MEDIA_MARKERS: Partial<Record<MessageType, string>> = {
  [MessageType.IMAGE]: "photo",
  [MessageType.AUDIO]: "voice",
  [MessageType.VIDEO]: "video",
  [MessageType.STICKER]: "sticker",
  [MessageType.FILE]: "file",
  [MessageType.LOCATION]: "location",
  [MessageType.CONTACT]: "contact",
  [MessageType.POLL]: "poll",
};

export interface ExcerptOptions {
  /** Total characters of excerpt text allowed across the whole selection. */
  charBudget: number;
  /** Maximum number of segments to include. */
  maxSegments?: number;
  /** Maximum messages taken from a single segment. */
  maxMessagesPerSegment?: number;
  /** Maximum characters kept from a single message. */
  maxCharsPerMessage?: number;
}

export interface ExcerptSelection {
  excerpts: Excerpt[];
  /** Every message id that was actually sent, for evidence validation. */
  includedIds: Set<string>;
  totalCharacters: number;
  segmentsConsidered: number;
}

interface ScoredSegment {
  segment: ConversationSegment;
  score: number;
}

/** Rewards real dialogue: turn-taking and questions over long monologues. */
function scoreSegment(
  segment: ConversationSegment,
  messages: readonly NormalizedMessage[],
): number {
  let turns = 0;
  let questions = 0;
  let textMessages = 0;
  let previousSender: string | null = null;

  for (let i = segment.startIndex; i <= segment.endIndex; i += 1) {
    const message = messages[i]!;
    if (previousSender !== null && message.senderId !== previousSender) turns += 1;
    previousSender = message.senderId;
    if (message.text.length > 0) textMessages += 1;
    if (message.text.includes("?")) questions += 1;
  }

  if (segment.participantIds.length < 2) return 0;
  return turns * 3 + Math.min(textMessages, 80) + questions * 2;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function buildExcerpt(
  segment: ConversationSegment,
  messages: readonly NormalizedMessage[],
  participantIdMap: ReadonlyMap<string, string>,
  maxMessages: number,
  maxChars: number,
): Excerpt {
  const end = Math.min(segment.endIndex, segment.startIndex + maxMessages - 1);
  const rendered: ExcerptMessage[] = [];

  for (let i = segment.startIndex; i <= end; i += 1) {
    const message = messages[i]!;
    const marker = MEDIA_MARKERS[message.type];
    const text = truncate(message.text, maxChars);
    if (text.length === 0 && !marker) continue;

    rendered.push({
      id: message.id,
      p: participantIdMap.get(message.senderId) ?? "?",
      m: Math.round((message.epochMs - segment.startEpochMs) / 60_000),
      t: text,
      ...(marker ? { media: marker } : {}),
    });
  }

  return {
    id: `s${segment.index}`,
    startIso: segment.startIso,
    endIso: segment.endIso,
    totalMessages: segment.messageCount,
    messages: rendered,
  };
}

function excerptCharacters(excerpt: Excerpt): number {
  return excerpt.messages.reduce(
    (sum, message) => sum + message.t.length + message.id.length + 8,
    0,
  );
}

export function selectExcerpts(
  messages: readonly NormalizedMessage[],
  segments: readonly ConversationSegment[],
  participantIdMap: ReadonlyMap<string, string>,
  options: ExcerptOptions,
): ExcerptSelection {
  const maxSegments = options.maxSegments ?? 40;
  const maxMessagesPerSegment = options.maxMessagesPerSegment ?? 40;
  const maxCharsPerMessage = options.maxCharsPerMessage ?? 280;

  // Segments with at least one exchange between two people.
  const eligible: ScoredSegment[] = segments
    .map((segment) => ({ segment, score: scoreSegment(segment, messages) }))
    .filter((entry) => entry.score > 0);

  const pool = eligible.length > 0
    ? eligible
    : segments.map((segment) => ({ segment, score: 1 }));

  // Spread the selection across the timeline: bucket by position, take the
  // best-scoring segment from each bucket, then fill with the next best.
  const bucketCount = Math.min(maxSegments, pool.length);
  const chosen: ConversationSegment[] = [];
  const used = new Set<number>();

  if (bucketCount > 0) {
    const perBucket = pool.length / bucketCount;
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const from = Math.floor(bucket * perBucket);
      const to = Math.min(pool.length, Math.floor((bucket + 1) * perBucket));
      let best: ScoredSegment | null = null;
      for (let i = from; i < to; i += 1) {
        const candidate = pool[i]!;
        if (used.has(candidate.segment.index)) continue;
        if (best === null || candidate.score > best.score) best = candidate;
      }
      if (best) {
        used.add(best.segment.index);
        chosen.push(best.segment);
      }
    }
  }

  const remaining = pool
    .filter((entry) => !used.has(entry.segment.index))
    .sort((a, b) => b.score - a.score);

  const excerpts: Excerpt[] = [];
  const includedIds = new Set<string>();
  let totalCharacters = 0;

  const tryAdd = (segment: ConversationSegment): boolean => {
    const excerpt = buildExcerpt(
      segment,
      messages,
      participantIdMap,
      maxMessagesPerSegment,
      maxCharsPerMessage,
    );
    if (excerpt.messages.length === 0) return false;
    const cost = excerptCharacters(excerpt);
    if (totalCharacters + cost > options.charBudget && excerpts.length > 0) return false;
    excerpts.push(excerpt);
    totalCharacters += cost;
    for (const message of excerpt.messages) includedIds.add(message.id);
    return true;
  };

  chosen
    .sort((a, b) => a.startEpochMs - b.startEpochMs)
    .forEach((segment) => tryAdd(segment));

  for (const entry of remaining) {
    if (excerpts.length >= maxSegments) break;
    if (totalCharacters >= options.charBudget) break;
    tryAdd(entry.segment);
  }

  excerpts.sort((a, b) => a.startIso.localeCompare(b.startIso));

  return {
    excerpts,
    includedIds,
    totalCharacters,
    segmentsConsidered: segments.length,
  };
}
