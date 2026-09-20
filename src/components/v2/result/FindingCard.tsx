"use client";

import * as React from "react";

import type { Confidence, Evidence } from "@/lib/ai/schema";
import { ConfidenceBadge } from "@/components/ui/Badge";
import { EvidenceDrawer, type EvidenceLookup } from "@/components/EvidenceDrawer";

export interface FindingCardProps {
  title: string;
  /** What is literally in the conversation. */
  observation?: string;
  /** One reading of it. Labelled as such, never merged with the observation. */
  interpretation?: string;
  /** What the data cannot settle. */
  uncertainty?: string;
  body?: string;
  confidence?: Confidence;
  evidence?: Evidence[];
  messages: EvidenceLookup;
  children?: React.ReactNode;
}

/**
 * The shared shape for every qualitative finding outside the flashcard deck.
 *
 * The three-way split is structural rather than a writing convention: an
 * observation and an interpretation cannot end up in the same paragraph,
 * because they are different fields with different labels.
 */
export function FindingCard({
  title,
  observation,
  interpretation,
  uncertainty,
  body,
  confidence,
  evidence,
  messages,
  children,
}: FindingCardProps) {
  return (
    <article className="rounded-xl border border-line bg-white px-5 py-5 print-block sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-base font-semibold leading-snug tracking-tight text-ink">
          {title}
        </h3>
        {confidence ? <ConfidenceBadge level={confidence} /> : null}
      </div>

      <div className="mt-4 space-y-3.5 text-[0.95rem] leading-relaxed">
        {body ? <p className="text-ink-soft">{body}</p> : null}

        {observation ? (
          <Block label="What's in the conversation">{observation}</Block>
        ) : null}
        {interpretation ? (
          <Block label="One way to read it" tone="brand">
            {interpretation}
          </Block>
        ) : null}
        {uncertainty ? (
          <Block label="What this can't tell you" tone="muted">
            {uncertainty}
          </Block>
        ) : null}

        {children}
      </div>

      {evidence && evidence.length > 0 ? (
        <EvidenceDrawer evidence={evidence} messages={messages} />
      ) : null}
    </article>
  );
}

function Block({
  label,
  tone = "neutral",
  children,
}: {
  label: string;
  tone?: "neutral" | "brand" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div className={tone === "brand" ? "border-l-2 border-brand-300 pl-4" : "border-l-2 border-line pl-4"}>
      <p
        className={
          tone === "brand"
            ? "text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-brand-700"
            : "text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted"
        }
      >
        {label}
      </p>
      <p className={tone === "muted" ? "mt-1 text-muted" : "mt-1 text-ink-soft"}>{children}</p>
    </div>
  );
}

/** Shown where a module produced nothing, with the reason rather than silence. */
export function EmptyModule({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded-xl border border-line bg-canvas-soft px-5 py-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted">{reason}</p>
    </div>
  );
}
