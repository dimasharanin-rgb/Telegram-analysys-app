/**
 * Putting what the media pipeline learned into what the model reads.
 *
 * The excerpts are built from text before any media has been looked at, because
 * the read window has to be decided before there is any point uploading a file.
 * This folds the findings back in afterwards, so a voice note reaches the
 * analysis as the words that were spoken and a screenshot as the text it
 * contained.
 *
 * The phrasing comes from `renderMediaParts`, shared with the single-event
 * renderer, so a transcript is introduced the same way wherever it appears.
 */

import { renderMediaParts, type EventMedia, type Transcript } from "@/lib/model/event";
import type { Excerpt } from "./schema";

/** Matches the excerpt schema's ceiling for one message. */
const MAX_MESSAGE_CHARS = 2_000;

export interface MediaContext {
  media: ReadonlyMap<string, readonly EventMedia[]>;
  transcripts: ReadonlyMap<string, Transcript>;
}

/**
 * Returns excerpts with media findings merged into each message's text.
 *
 * Non-mutating: the stored job input keeps the text-only version, so re-running
 * with different media settings starts from the same place rather than from a
 * previous run's additions.
 */
export function enrichExcerpts(
  excerpts: readonly Excerpt[],
  context: MediaContext,
): Excerpt[] {
  if (context.media.size === 0 && context.transcripts.size === 0) {
    return excerpts as Excerpt[];
  }

  return excerpts.map((excerpt) => ({
    ...excerpt,
    messages: excerpt.messages.map((message) => {
      const media = context.media.get(message.id);
      const transcript = context.transcripts.get(message.id) ?? null;
      if (media === undefined && transcript === null) return message;

      const parts = renderMediaParts(
        transcript !== null,
        media ?? [],
        transcript,
      );
      if (parts.length === 0) return message;

      const combined = [message.t.trim(), ...parts].filter((part) => part.length > 0).join(" ");
      return { ...message, t: truncate(combined, MAX_MESSAGE_CHARS) };
    }),
  }));
}

/** Cuts on a word boundary where possible, so a transcript does not end mid-word. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
