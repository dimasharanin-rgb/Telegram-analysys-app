/**
 * Turning what the media stage did into the report's media section.
 *
 * Deliberately separate from the stage itself: the stage's job is to decide and
 * record, and this decides what a reader is allowed to see. Keeping them apart
 * is what makes it possible to assert that no classification name can reach the
 * result, which is a test rather than a promise.
 */

import type { MediaFindingItem, MediaFindings } from "@/lib/pipeline/modular";
import { TranscriptionStatus } from "@/lib/model/event";
import type { MediaOutcome } from "@/server/media/process";

export interface MediaSummaryContext {
  /** Wall-clock time per message id, for ordering and for the displayed date. */
  timeById: ReadonlyMap<string, string>;
  /** Pseudonymous label per message id, matching the rest of the report. */
  participantById: ReadonlyMap<string, string>;
}

/** The longest excerpt of read text shown beside one attachment. */
const MAX_DETAIL_CHARS = 200;

export function summariseMedia(
  outcome: MediaOutcome,
  context: MediaSummaryContext,
): MediaFindings | null {
  if (outcome.summary.considered === 0) return null;

  const items: MediaFindingItem[] = [];

  for (const [messageId, attachments] of outcome.media) {
    const transcript = outcome.transcripts.get(messageId) ?? null;

    for (const attachment of attachments) {
      const detail =
        transcript?.status === TranscriptionStatus.COMPLETED && transcript.text.length > 0
          ? truncate(transcript.text, MAX_DETAIL_CHARS)
          : attachment.extractedText !== null
            ? truncate(attachment.extractedText, MAX_DETAIL_CHARS)
            : attachment.description !== null
              ? truncate(attachment.description, MAX_DETAIL_CHARS)
              : null;

      items.push({
        at: context.timeById.get(messageId) ?? "",
        participant: context.participantById.get(messageId) ?? "?",
        // Already safe by construction: publicMediaLabel never contains a
        // classification, and nothing else writes this field.
        label: attachment.label,
        detail,
      });
    }
  }

  items.sort((a, b) => a.at.localeCompare(b.at));

  return { ...outcome.summary, items };
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}\u2026`;
}
