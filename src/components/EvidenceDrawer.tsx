"use client";

import * as React from "react";
import type { Evidence } from "@/lib/ai/schema";
import { formatDateTime, cx } from "@/lib/client/format";
import { seriesColor } from "@/lib/palette";

/**
 * One quoted message, as the evidence view needs it.
 *
 * Deliberately not the full message model: evidence is rendered from what the
 * server still holds after a run, which is the quoted exchanges and nothing
 * else.
 */
export interface EvidenceMessageView {
  id: string;
  senderName: string;
  /** Wall-clock time, `YYYY-MM-DDTHH:mm:ss`. */
  iso: string;
  text: string;
  /** Index into the series palette, so colours match the rest of the app. */
  colorIndex: number;
}

export type EvidenceLookup = ReadonlyMap<string, EvidenceMessageView>;

export interface EvidenceDrawerProps {
  evidence: Evidence[];
  messages: EvidenceLookup;
}

/**
 * Evidence view.
 *
 * Quotes are rendered from stored messages looked up by id, rather than from
 * text the model echoed back - so an excerpt shown here is always something
 * that was really in the export. Only the cited exchanges are shown, never the
 * conversation.
 */
export function EvidenceDrawer({ evidence, messages }: EvidenceDrawerProps) {
  const [open, setOpen] = React.useState(false);

  const resolved = React.useMemo(
    () =>
      evidence.map((entry) => ({
        excerpt: entry.excerpt,
        messages: entry.messageIds
          .map((id) => messages.get(id))
          .filter((message): message is EvidenceMessageView => message !== undefined),
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
                        style={{ backgroundColor: seriesColor(message.colorIndex) }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                          <span className="font-medium text-ink-soft">
                            {message.senderName}
                          </span>
                          <span>{formatDateTime(message.iso)}</span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
                          {message.text.length > 0 ? message.text : "(no text)"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm italic leading-relaxed text-muted">{entry.excerpt}</p>
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
