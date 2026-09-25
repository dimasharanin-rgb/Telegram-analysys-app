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
  /**
   * Segments that must be included whatever they score - the exchanges the
   * conflict heuristic shortlisted, so the module analysing them can actually
   * see them.
   */
  prioritySegmentIndices?: readonly number[];
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

/**
 * What the conversation looks like as a whole, for the signals that are only
 * meaningful in comparison.
 *
 * "An unusually busy exchange" has no meaning for one segment in isolation -
 * it needs to know what a typical segment looks like in this particular chat.
 */
interface SegmentContext {
  /** When the conversation starts and ends, for the recency weighting. */
  firstEpochMs: number;
  lastEpochMs: number;
  /** Median messages per segment, which defines what "unusual" means here. */
  typicalLength: number;
}

export function buildSegmentContext(
  messages: readonly NormalizedMessage[],
  segments: readonly ConversationSegment[],
): SegmentContext {
  const lengths = segments
    .map((segment) => segment.endIndex - segment.startIndex + 1)
    .sort((a, b) => a - b);
  const middle = Math.floor(lengths.length / 2);

  return {
    firstEpochMs: messages[0]?.epochMs ?? 0,
    lastEpochMs: messages[messages.length - 1]?.epochMs ?? 0,
    typicalLength: lengths.length === 0 ? 1 : (lengths[middle] ?? 1),
  };
}

/**
 * How much this exchange is worth reading.
 *
 * Dialogue is the base: turn-taking and questions, because a back-and-forth
 * says more about two people than a monologue of the same length. On top of
 * that sit the four signals §30 asks for when a conversation is too large to
 * read whole - the ones that decide which parts of a decade-long chat are worth
 * the budget.
 *
 * All four are bonuses rather than multipliers, so no single signal can crowd
 * out ordinary conversation entirely. A chat that is nothing but photographs
 * should not produce an analysis made only of photograph captions.
 */
function scoreSegment(
  segment: ConversationSegment,
  messages: readonly NormalizedMessage[],
  context: SegmentContext,
): number {
  let turns = 0;
  let questions = 0;
  let textMessages = 0;
  let longMessages = 0;
  let mediaMessages = 0;
  let previousSender: string | null = null;

  for (let i = segment.startIndex; i <= segment.endIndex; i += 1) {
    const message = messages[i]!;
    if (previousSender !== null && message.senderId !== previousSender) turns += 1;
    previousSender = message.senderId;
    if (message.text.length > 0) textMessages += 1;
    if (message.text.includes("?")) questions += 1;
    // A message someone took time over is more likely to carry the thing they
    // actually wanted to say.
    if (message.text.length >= LONG_MESSAGE_CHARS) longMessages += 1;
    if (message.hasMedia) mediaMessages += 1;
  }

  if (segment.participantIds.length < 2) return 0;

  const base = turns * 3 + Math.min(textMessages, 80) + questions * 2;

  const length = segment.endIndex - segment.startIndex + 1;
  // A burst several times the usual length is where something happened.
  const unusual = length >= context.typicalLength * UNUSUAL_LENGTH_FACTOR ? 12 : 0;

  return (
    base +
    Math.min(longMessages, 10) * 2 +
    Math.min(mediaMessages, 8) * 2 +
    unusual +
    recencyBonus(segment, context)
  );
}

/** Messages at or above this length are treated as considered rather than tossed off. */
const LONG_MESSAGE_CHARS = 280;

/** How many times the typical segment length counts as a burst. */
const UNUSUAL_LENGTH_FACTOR = 3;

/** The most a segment can gain for being recent. */
const MAX_RECENCY_BONUS = 15;

/**
 * Weights the recent end of the conversation.
 *
 * Bounded and linear rather than steep: recent matters most when someone is
 * asking about a relationship now, but an analysis that only read the last
 * month cannot say what changed, and "what changed" is most of the value.
 */
function recencyBonus(
  segment: ConversationSegment,
  context: SegmentContext,
): number {
  const span = context.lastEpochMs - context.firstEpochMs;
  if (span <= 0) return 0;
  const position = (segment.startEpochMs - context.firstEpochMs) / span;
  return Math.round(Math.min(1, Math.max(0, position)) * MAX_RECENCY_BONUS);
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
  const context = buildSegmentContext(messages, segments);
  const eligible: ScoredSegment[] = segments
    .map((segment) => ({ segment, score: scoreSegment(segment, messages, context) }))
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
  const priority = new Set(options.prioritySegmentIndices ?? []);

  const added = new Set<number>();

  const tryAdd = (segment: ConversationSegment, force = false): boolean => {
    if (added.has(segment.index)) return false;
    const excerpt = buildExcerpt(
      segment,
      messages,
      participantIdMap,
      maxMessagesPerSegment,
      maxCharsPerMessage,
    );
    if (excerpt.messages.length === 0) return false;
    const cost = excerptCharacters(excerpt);
    if (!force && totalCharacters + cost > options.charBudget && excerpts.length > 0) {
      return false;
    }
    excerpts.push(excerpt);
    added.add(segment.index);
    totalCharacters += cost;
    for (const message of excerpt.messages) includedIds.add(message.id);
    return true;
  };

  // Priority segments go in first and are not subject to the budget check:
  // a shortlisted difficult moment that got dropped would leave the module
  // analysing it with nothing to read.
  if (priority.size > 0) {
    for (const segment of segments) {
      if (priority.has(segment.index)) tryAdd(segment, true);
    }
  }

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
