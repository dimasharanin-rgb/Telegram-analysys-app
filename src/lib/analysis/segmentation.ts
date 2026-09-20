/**
 * Conversation segmentation.
 *
 * Telegram exports are one long stream of messages. Almost every interesting
 * statistic - who starts conversations, how fast people reply - only means
 * anything once that stream is cut into separate conversations.
 *
 * The heuristic, deliberately simple and documented so it can be argued with:
 *
 *   A message starts a new conversation when more than `gapMinutes` of
 *   silence preceded it (default 6 hours). Everything else continues the
 *   current conversation.
 *
 * This is a proxy, not ground truth. A reply sent seven hours later is still a
 * reply; two unrelated topics five minutes apart are still one segment here.
 * The UI says so wherever these numbers are shown.
 */

import type { NormalizedMessage } from "@/lib/model/message";

export interface ConversationSegment {
  index: number;
  /** Index into the message array of the first message in this segment. */
  startIndex: number;
  /** Index into the message array of the last message, inclusive. */
  endIndex: number;
  startEpochMs: number;
  endEpochMs: number;
  startIso: string;
  endIso: string;
  messageCount: number;
  /** Sender of the first message - the "initiator" under this heuristic. */
  initiatorId: string;
  /** Participants who said anything in this segment. */
  participantIds: string[];
}

export const DEFAULT_GAP_MINUTES = 360;

export function segmentConversations(
  messages: readonly NormalizedMessage[],
  gapMinutes: number = DEFAULT_GAP_MINUTES,
): ConversationSegment[] {
  if (messages.length === 0) return [];

  const gapMs = gapMinutes * 60_000;
  const segments: ConversationSegment[] = [];
  let startIndex = 0;

  const push = (start: number, end: number) => {
    const first = messages[start]!;
    const last = messages[end]!;
    const participantIds = new Set<string>();
    for (let i = start; i <= end; i += 1) participantIds.add(messages[i]!.senderId);
    segments.push({
      index: segments.length,
      startIndex: start,
      endIndex: end,
      startEpochMs: first.epochMs,
      endEpochMs: last.epochMs,
      startIso: first.localIso,
      endIso: last.localIso,
      messageCount: end - start + 1,
      initiatorId: first.senderId,
      participantIds: [...participantIds],
    });
  };

  for (let i = 1; i < messages.length; i += 1) {
    const gap = messages[i]!.epochMs - messages[i - 1]!.epochMs;
    if (gap > gapMs) {
      push(startIndex, i - 1);
      startIndex = i;
    }
  }
  push(startIndex, messages.length - 1);

  return segments;
}

/** Human-readable description of the heuristic, surfaced in the UI and PDF. */
export function segmentationDescription(gapMinutes: number): string {
  const hours = gapMinutes / 60;
  const unit =
    gapMinutes % 60 === 0
      ? `${hours} hour${hours === 1 ? "" : "s"}`
      : `${gapMinutes} minutes`;
  return `A new conversation is counted whenever more than ${unit} passed since the previous message. This is an approximation, not a record of what the participants considered a separate conversation.`;
}
