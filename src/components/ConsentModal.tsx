"use client";

import * as React from "react";
import { formatNumber } from "@/lib/client/format";
import { Button } from "./ui/Button";

export interface ConsentModalProps {
  /** How many messages will be included as excerpts. */
  excerptMessages: number;
  excerptCharacters: number;
  totalMessages: number;
  participantCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The gate in front of every request that leaves the device.
 *
 * It states what is sent, where it goes, why, and whose data it is. The
 * checkbox records the user's own confirmation - which is not the same thing
 * as consent from the other people in the conversation, and the copy says so.
 *
 * It is rendered only while open, so unmounting is what resets the checkboxes.
 */
export function ConsentModal({
  excerptMessages,
  excerptCharacters,
  totalMessages,
  participantCount,
  onConfirm,
  onCancel,
}: ConsentModalProps) {
  const [authorised, setAuthorised] = React.useState(false);
  const [understood, setUnderstood] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const firstFocusRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    firstFocusRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key !== "Tab") return;
      // Keep focus inside the dialog while it is open.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const ready = authorised && understood;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        className="animate-card-enter max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-line bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="border-b border-line px-5 py-4 sm:px-7 sm:py-5">
          <h2 id="consent-title" className="text-lg font-semibold tracking-tight">
            Before the analysis runs
          </h2>
          <p className="mt-1 text-sm text-muted">
            This is the one step where part of your conversation leaves this device.
          </p>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-7">
          <section>
            <h3 className="text-sm font-semibold text-ink">What gets sent</h3>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-soft">
              <li>
                · A digest of the statistics already computed here — counts, shares,
                response times, top words.
              </li>
              <li>
                · <strong>{formatNumber(excerptMessages)} messages</strong> (about{" "}
                {formatNumber(excerptCharacters)} characters) selected from across the{" "}
                {formatNumber(totalMessages)} in this conversation, as conversation
                excerpts.
              </li>
              <li>
                · Participants are labelled &ldquo;Participant A&rdquo; and
                &ldquo;Participant B&rdquo;. Display names are not sent.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink">Where it goes, and why</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              To this application&rsquo;s server, and from there to its AI provider,
              Anthropic, which processes the text to produce the pattern analysis. It is
              not stored: there is no database, and the results live only in this browser
              tab. Photos, voice notes and videos are never sent.
            </p>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-ink">Other people&rsquo;s messages</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {participantCount > 2
                ? `This conversation involves ${participantCount} people.`
                : "This conversation involves someone else."}{" "}
              They have not agreed to this analysis, and depending on where you live they
              may have rights over their own messages. Only continue with conversations
              you are authorised to process.
            </p>
          </section>

          <div className="space-y-3 rounded-lg border border-line bg-canvas-soft px-4 py-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-ink">
              <input
                type="checkbox"
                checked={authorised}
                onChange={(event) => setAuthorised(event.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
              />
              <span>
                I am authorised to process this conversation, including the other
                participants&rsquo; messages.
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-ink">
              <input
                type="checkbox"
                checked={understood}
                onChange={(event) => setUnderstood(event.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
              />
              <span>
                I understand the selected excerpts will be processed by the
                application&rsquo;s AI provider, and that the analysis is interpretation
                rather than a psychological assessment.
              </span>
            </label>
          </div>

          <p className="text-xs leading-relaxed text-faint">
            This confirmation records your decision. It is not consent from the other
            participants, and it does not by itself make this use lawful where you are.
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
          <Button ref={firstFocusRef} variant="secondary" onClick={onCancel}>
            Go back
          </Button>
          <Button onClick={onConfirm} disabled={!ready}>
            Start analysis
          </Button>
        </div>
      </div>
    </div>
  );
}
