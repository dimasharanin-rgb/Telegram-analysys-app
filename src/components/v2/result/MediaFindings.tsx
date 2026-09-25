"use client";

import * as React from "react";

import type { MediaFindings } from "@/lib/pipeline/modular";
import { formatNumber } from "@/lib/client/format";
import { SectionTitle } from "@/components/ui/Card";

/**
 * What happened to the attachments.
 *
 * Two rules from §39 shape this. Media appears in the conversation's own
 * timeline rather than in a separate media section, so the panel is ordered by
 * time and reads as part of the chat. And nothing internal shows: no provider
 * name, no classification, no confidence score. A reader sees "Private image —
 * not analyzed" and that is the whole truth they need, because the alternative
 * is telling someone what a model concluded about a photograph they sent
 * someone they love.
 */
export function MediaFindingsPanel({ media }: { media: MediaFindings }) {
  if (media.considered === 0) return null;

  return (
    <section className="space-y-4">
      <SectionTitle>Attachments</SectionTitle>

      <p className="text-sm leading-relaxed text-muted">
        {summarise(media)}
      </p>

      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {media.items.map((item, index) => (
          <li
            key={`${item.at}-${index}`}
            className="flex gap-3 bg-canvas px-4 py-3 text-sm"
          >
            <span aria-hidden="true" className="pt-0.5 text-base leading-none">
              {iconFor(item.label)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium text-ink">{item.label}</span>
                <span className="text-xs text-faint">
                  {item.participant} · {displayTime(item.at)}
                </span>
              </p>
              {item.detail !== null ? (
                <p className="mt-1 break-words text-ink-soft">
                  <span className="text-muted">“</span>
                  {item.detail}
                  <span className="text-muted">”</span>
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The counts, as a sentence.
 *
 * Says what was not read as plainly as what was, because an analysis that
 * quietly skipped half the attachments is an analysis whose reader should know.
 */
function summarise(media: MediaFindings): string {
  const parts: string[] = [];

  if (media.transcribed > 0) {
    parts.push(
      `${formatNumber(media.transcribed)} voice ${media.transcribed === 1 ? "message" : "messages"} transcribed`,
    );
  }
  if (media.described > 0) {
    parts.push(`${formatNumber(media.described)} read for content`);
  }
  if (media.withheld > 0) {
    parts.push(`${formatNumber(media.withheld)} counted but not examined`);
  }
  if (media.failed > 0) {
    parts.push(`${formatNumber(media.failed)} could not be processed`);
  }

  const detail = parts.length > 0 ? ` — ${parts.join(", ")}.` : ".";
  return `This conversation had ${formatNumber(media.considered)} ${
    media.considered === 1 ? "attachment" : "attachments"
  } inside the analysed period${detail}`;
}

/** An icon from the label alone, so no internal field decides what is shown. */
function iconFor(label: string): string {
  const lower = label.toLowerCase();
  if (lower.startsWith("voice")) return "🎤";
  if (lower.startsWith("document")) return "📄";
  if (lower.startsWith("video")) return "🎬";
  if (lower.includes("private")) return "🔒";
  return "🖼";
}

function displayTime(at: string): string {
  if (at.length === 0) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
