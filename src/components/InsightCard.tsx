"use client";

import * as React from "react";
import type { InsightCardModel } from "@/lib/client/insights";
import { cx } from "@/lib/client/format";
import { ConfidenceBadge, Badge } from "./ui/Badge";
import { EvidenceDrawer, type EvidenceLookup } from "./EvidenceDrawer";

export interface InsightCardProps {
  card: InsightCardModel;
  index: number;
  total: number;
  messages: EvidenceLookup;
}

const KIND_ACCENT: Record<InsightCardModel["kind"], string> = {
  overview: "bg-brand-600",
  measured: "bg-brand-600",
  pattern: "bg-series-2",
  strength: "bg-positive",
  watchout: "bg-caution",
  suggestion: "bg-series-3",
  topic: "bg-series-2",
};

/**
 * One insight, one card.
 *
 * The three-way split is visible in the layout, not just the copy: what was
 * observed, what it might mean, and what the data cannot settle each get their
 * own labelled block, so interpretation is never mistaken for fact.
 */
export function InsightCard({ card, index, total, messages }: InsightCardProps) {
  return (
    <article
      className="animate-card-enter flex h-full flex-col overflow-hidden rounded-xl border border-line bg-white surface-raised"
      aria-label={`Insight ${index + 1} of ${total}: ${card.title}`}
    >
      <div aria-hidden="true" className={cx("h-1 w-full", KIND_ACCENT[card.kind])} />

      <div className="flex flex-1 flex-col px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">
            {card.categoryLabel}
          </span>
          {card.measured ? (
            <Badge tone="brand">Measured</Badge>
          ) : (
            <Badge tone="neutral">AI interpretation</Badge>
          )}
          {card.confidence ? <ConfidenceBadge level={card.confidence} /> : null}
        </div>

        <h3 className="mt-3 text-xl font-semibold leading-snug tracking-tight text-ink sm:text-2xl">
          {card.title}
        </h3>

        {card.headline ? (
          <div className="mt-5 rounded-lg bg-brand-50 px-4 py-4">
            <p className="text-4xl font-semibold leading-none tracking-tight text-brand-700 sm:text-5xl">
              {card.headline.value}
            </p>
            {card.headline.caption ? (
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {card.headline.caption}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 space-y-4 text-[0.95rem] leading-relaxed">
          {card.body ? <p className="text-ink-soft">{card.body}</p> : null}

          {card.observation ? (
            <Block label="What's in the conversation" tone="neutral">
              {card.observation}
            </Block>
          ) : null}

          {card.interpretation ? (
            <Block label="One way to read it" tone="brand">
              {card.interpretation}
            </Block>
          ) : null}

          {card.uncertainty ? (
            <Block label="What this can't tell you" tone="muted">
              {card.uncertainty}
            </Block>
          ) : null}

          {card.suggestion ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3">
                <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-positive">
                  Try
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink">{card.suggestion.do}</p>
              </div>
              <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-3">
                <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-caution">
                  Avoid
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink">
                  {card.suggestion.avoid}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-auto">
          <EvidenceDrawer evidence={card.evidence} messages={messages} />
        </div>
      </div>
    </article>
  );
}

function Block({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "neutral" | "brand" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "border-l-2 pl-4",
        tone === "brand" && "border-brand-300",
        tone === "neutral" && "border-line",
        tone === "muted" && "border-line",
      )}
    >
      <p
        className={cx(
          "text-[0.7rem] font-semibold uppercase tracking-[0.06em]",
          tone === "brand" ? "text-brand-700" : "text-muted",
        )}
      >
        {label}
      </p>
      <p className={cx("mt-1", tone === "muted" ? "text-muted" : "text-ink-soft")}>
        {children}
      </p>
    </div>
  );
}
