"use client";

import * as React from "react";
import type { Evidence } from "@/lib/ai/schema";
import type { NormalizedMessage } from "@/lib/model/message";
import { MEDIA_PLACEHOLDER, MessageType } from "@/lib/model/message";
import { formatDateTime, cx } from "@/lib/client/format";
import { seriesColor } from "@/lib/palette";

export interface EvidenceDrawerProps {
  evidence: Evidence[];
  /** Resolves a message id to the real message held locally. */
  messages: ReadonlyMap<string, NormalizedMessage>;
  /** Participant id → colour index, so quotes match the rest of the app. */
  colorIndex: ReadonlyMap<string, number>;
}

/**
 * Evidence view.
 *
 * Quotes are rendered from the messages held in this browser, looked up by id,
 * rather than from text the model echoed back - so an excerpt shown here is
 * always something that was really in the export. Only the cited messages are
 * shown, never the surrounding conversation.
 */
export function EvidenceDrawer({ evidence, messages, colorIndex }: EvidenceDrawerProps) {
  const [open, setOpen] = React.useState(false);

  const resolved = React.useMemo(
    () =>
      evidence.map((entry) => ({
        excerpt: entry.excerpt,
        messages: entry.messageIds
          .map((id) => messages.get(id))
          .filter((message): message is NormalizedMessage => message !== undefined),
      })),
    [evidence, messages],
  );

  const quoteCount = resolved.reduce((sum, entry) => sum + entry.messages.length, 0);
  if (evidence.length === 0) return null;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-md text-left text-sm font-medium text-brand-700 hover:text-brand-800"
      >
        <span>
          {open ? "Hide evidence" : "Show evidence"}
          {quoteCount > 0 ? (
            <span className="ml-1.5 font-normal text-muted">
              ({quoteCount} {quoteCount === 1 ? "message" : "messages"})
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className={cx("transition-transform", open && "rotate-180")}>
          ⌄
        </span>
      </button>

      {open ? (
        <div className="animate-fade-in mt-4 space-y-4">
          <p className="text-xs leading-relaxed text-faint">
            These are conversation excerpts the analysis referred to. They show what was
            written — not proof of what anyone meant or felt.
          </p>

          {resolved.map((entry, index) => (
            <div key={index} className="rounded-lg border border-line bg-canvas-soft p-3">
              {entry.messages.length > 0 ? (
                <ul className="space-y-2.5">
                  {entry.messages.map((message) => (
                    <li key={message.id} className="flex gap-2.5">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: seriesColor(
                            colorIndex.get(message.senderId) ?? 0,
                          ),
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                          <span className="font-medium text-ink-soft">
                            {message.senderName}
                          </span>
                          <span>{formatDateTime(message.localIso)}</span>
                          {message.edited ? <span>· edited</span> : null}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
                          {message.text.length > 0
                            ? message.text
                            : describeMedia(message)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm italic leading-relaxed text-muted">
                  {entry.excerpt}
                </p>
              )}

              {entry.messages.length > 0 && entry.excerpt.trim().length > 0 ? (
                <p className="mt-3 border-t border-line pt-2 text-xs leading-relaxed text-muted">
                  <span className="font-medium text-ink-soft">Why this was cited: </span>
                  {entry.excerpt}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function describeMedia(message: NormalizedMessage): string {
  if (!message.hasMedia) return "(no text)";
  const kind = message.media[0]?.kind;
  const label =
    kind === MessageType.IMAGE
      ? "photo"
      : kind === MessageType.AUDIO
        ? "voice message"
        : kind === MessageType.VIDEO
          ? "video"
          : kind === MessageType.STICKER
            ? "sticker"
            : "attachment";
  return `[${label}] ${MEDIA_PLACEHOLDER}`;
}
