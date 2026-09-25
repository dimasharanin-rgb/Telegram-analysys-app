"use client";

import * as React from "react";

import type { TimelineFindings } from "@/lib/ai/modules/schemas";
import type { AdvancedStatistics } from "@/lib/stats/advanced";
import type { EvidenceLookup } from "@/components/EvidenceDrawer";
import { cx, formatDate, formatNumber } from "@/lib/client/format";
import { SectionTitle } from "@/components/ui/Card";
import { EmptyModule, FindingCard } from "./FindingCard";
import { MediaFindingsPanel } from "./MediaFindings";
import type { MediaFindings } from "@/lib/pipeline/modular";

const DIRECTION_LABEL = { up: "↑", down: "↓", flat: "→" } as const;

export function TimelineTab({
  timeline,
  advanced,
  messages,
  media,
}: {
  timeline: TimelineFindings | null;
  advanced: AdvancedStatistics;
  messages: EvidenceLookup;
  /** Attachments belong in the conversation's timeline, not a page of their own. */
  media: MediaFindings | null;
}) {
  const { periods, changes, comparable, note } = advanced.timeline;

  if (!comparable) {
    return (
      <div className="space-y-8">
        <EmptyModule title="Not enough history to compare periods" reason={note} />
        {media ? <MediaFindingsPanel media={media} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle hint={note}>The periods</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          {periods.map((period) => (
            <div
              key={period.id}
              className="rounded-xl border border-line bg-white px-4 py-4 print-block"
            >
              <p className="text-sm font-semibold text-ink">{period.label}</p>
              <p className="mt-0.5 text-xs text-muted">
                {formatDate(period.startDate)} – {formatDate(period.endDate)}
              </p>
              <dl className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Messages</dt>
                  <dd className="tabular-nums text-ink">{formatNumber(period.messages)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Average length</dt>
                  <dd className="tabular-nums text-ink">
                    {Math.round(period.averageLength)} chars
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Per conversation</dt>
                  <dd className="tabular-nums text-ink">
                    {period.averageMessagesPerConversation}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Tension wording</dt>
                  <dd className="tabular-nums text-ink">{period.indicators.tension}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Warmth wording</dt>
                  <dd className="tabular-nums text-ink">{period.indicators.warmth}</dd>
                </div>
              </dl>
              {period.topWords.length > 0 ? (
                <p className="mt-3 border-t border-line pt-2 text-xs leading-relaxed text-faint">
                  {period.topWords.slice(0, 5).join(" · ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle hint="Early period → recent period">What changed</SectionTitle>
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {changes.map((change) => (
            <li
              key={change.metric}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5"
            >
              <span className="text-sm text-ink">{change.label}</span>
              <span className="flex items-center gap-3 text-sm tabular-nums">
                <span className="text-muted">{change.earlyLabel}</span>
                <span
                  aria-hidden="true"
                  className={cx(
                    "text-base",
                    change.direction === "flat" ? "text-faint" : "text-brand-600",
                  )}
                >
                  {DIRECTION_LABEL[change.direction]}
                </span>
                <span className="font-medium text-ink">{change.recentLabel}</span>
                <span
                  className={cx(
                    "w-16 text-right text-xs",
                    change.direction === "flat" ? "text-faint" : "text-muted",
                  )}
                >
                  {change.direction === "flat"
                    ? "no change"
                    : `${change.changePercent > 0 ? "+" : ""}${change.changePercent}%`}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          Periods are equal thirds by message count, so each rests on the same amount of
          evidence. A change under about 10% is treated as no change.
        </p>
      </section>

      {timeline ? (
        <section>
          <SectionTitle hint="AI interpretation">Reading the change</SectionTitle>
          <p className="mb-4 text-[0.95rem] leading-relaxed text-ink-soft">
            {timeline.summary}
          </p>
          <div className="space-y-4">
            {timeline.changes.map((change) => (
              <FindingCard
                key={change.title}
                title={change.title}
                interpretation={change.interpretation}
                uncertainty={change.uncertainty}
                confidence={change.confidence}
                evidence={change.evidence}
                messages={messages}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-line bg-canvas-soft px-4 py-3">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
                      Earlier
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-ink">{change.earlier}</p>
                  </div>
                  <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-700">
                      Recently
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-ink">{change.later}</p>
                  </div>
                </div>
              </FindingCard>
            ))}
          </div>

          {timeline.continuities.length > 0 ? (
            <div className="mt-5 rounded-xl border border-line bg-canvas-soft px-5 py-4">
              <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
                What stayed the same
              </p>
              <ul className="mt-2 space-y-1.5">
                {timeline.continuities.map((item) => (
                  <li key={item} className="text-sm leading-relaxed text-ink-soft">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {media ? <MediaFindingsPanel media={media} /> : null}
    </div>
  );
}
