"use client";

/**
 * The written guidance, available without spending anything.
 *
 * Most of what someone wants here does not need their messages read: "how do
 * I apologise" has a good answer that is the same for everyone. Answering
 * those from a library is what makes the free tier useful, and keeps the
 * metered requests for the one thing only the model can do - applying it to
 * the exchange in front of you.
 */

import * as React from "react";

import { ADVICE_LIBRARY, type AdviceTopic } from "@/lib/advice/library";
import { cx } from "@/lib/client/format";
import { Button } from "@/components/ui/Button";
import { SectionTitle } from "@/components/ui/Card";

export interface AdviceLibraryProps {
  /** Runs an AI request applying this topic to the chosen exchange. */
  onPersonalise?: (topic: AdviceTopic) => void;
  /** False when the allowance is spent, so the offer is not made falsely. */
  canPersonalise: boolean;
  busy: boolean;
}

function TopicPanel({
  topic,
  onPersonalise,
  canPersonalise,
  busy,
}: {
  topic: AdviceTopic;
  onPersonalise?: (topic: AdviceTopic) => void;
  canPersonalise: boolean;
  busy: boolean;
}) {
  return (
    <div className="border-t border-line px-5 pb-5 pt-4">
      <ol className="space-y-2.5">
        {topic.steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm leading-relaxed text-ink-soft">
            <span
              aria-hidden="true"
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700"
            >
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <div className="mt-4 rounded-lg border border-line bg-canvas-soft px-4 py-3">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
          One way to open it
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink">{topic.example}</p>
      </div>

      <div className="mt-4">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-caution">
          What tends to make it harder
        </p>
        <ul className="mt-1.5 space-y-1.5">
          {topic.avoid.map((entry) => (
            <li key={entry} className="text-sm leading-relaxed text-muted">
              {entry}
            </li>
          ))}
        </ul>
      </div>

      {onPersonalise ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={!canPersonalise || busy}
            onClick={() => onPersonalise(topic)}
          >
            {busy ? "Thinking…" : "Personalise this for my conversation"}
          </Button>
          <span className="text-xs text-faint">
            {canPersonalise
              ? "Uses one advice request."
              : "No advice requests left on this analysis."}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function AdviceLibrary({
  onPersonalise,
  canPersonalise,
  busy,
}: AdviceLibraryProps) {
  const [open, setOpen] = React.useState<string | null>(null);

  return (
    <section>
      <SectionTitle hint="Free — no AI request">Written guidance</SectionTitle>
      <p className="mb-4 text-sm leading-relaxed text-muted">
        Written in advance, so it costs nothing to read. Each one can be applied to a
        specific exchange from your conversation, which does use a request.
      </p>

      <ul className="space-y-2">
        {ADVICE_LIBRARY.map((topic) => {
          const expanded = open === topic.id;
          return (
            <li
              key={topic.id}
              className="overflow-hidden rounded-xl border border-line bg-white"
            >
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : topic.id)}
                className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">
                    {topic.title}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                    {topic.summary}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cx(
                    "mt-1 shrink-0 text-muted transition-transform",
                    expanded && "rotate-180",
                  )}
                >
                  ▾
                </span>
              </button>

              {expanded ? (
                <TopicPanel
                  topic={topic}
                  {...(onPersonalise ? { onPersonalise } : {})}
                  canPersonalise={canPersonalise}
                  busy={busy}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
