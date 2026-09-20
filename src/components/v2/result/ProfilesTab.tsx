"use client";

import * as React from "react";

import type { ProfileFindings } from "@/lib/ai/modules/schemas";
import { EvidenceDrawer, type EvidenceLookup } from "@/components/EvidenceDrawer";
import { cx } from "@/lib/client/format";
import { seriesColor } from "@/lib/palette";
import { EmptyModule } from "./FindingCard";

const LEVEL_LABEL: Record<string, string> = {
  high: "High",
  moderate: "Moderate",
  low: "Low",
  "insufficient-evidence": "Not enough evidence",
};

/** Filled dots for a level, with the label always present beside them. */
function LevelMeter({ level }: { level: string }) {
  const filled = level === "high" ? 3 : level === "moderate" ? 2 : level === "low" ? 1 : 0;
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className="flex gap-1">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={cx(
              "h-1.5 w-4 rounded-full",
              index < filled ? "bg-brand-600" : "bg-line",
            )}
          />
        ))}
      </span>
      <span
        className={cx(
          "text-xs font-medium",
          level === "insufficient-evidence" ? "text-muted" : "text-ink-soft",
        )}
      >
        {LEVEL_LABEL[level] ?? level}
      </span>
    </span>
  );
}

export function ProfilesTab({
  profiles,
  nameFor,
  colorIndexFor,
  messages,
}: {
  profiles: ProfileFindings | null;
  nameFor: (pseudonym: string) => string;
  colorIndexFor: (pseudonym: string) => number;
  messages: EvidenceLookup;
}) {
  if (!profiles || profiles.profiles.length === 0) {
    return (
      <EmptyModule
        title="No communication profiles"
        reason="This analysis did not include the profiles module, or it produced nothing that could be evidenced."
      />
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-muted">
        These describe observable messaging behaviour — how each person writes, asks and
        follows up. They are not descriptions of anyone&rsquo;s character, and
        &ldquo;not enough evidence&rdquo; is a real answer rather than a gap.
      </p>

      {profiles.profiles.map((profile) => (
        <div
          key={profile.participantId}
          className="rounded-xl border border-line bg-white print-block"
        >
          <div className="flex items-center gap-3 border-b border-line px-5 py-4 sm:px-6">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: seriesColor(colorIndexFor(profile.participantId)) }}
            />
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold tracking-tight text-ink">
                {nameFor(profile.participantId)}
              </h3>
              <p className="mt-0.5 text-sm leading-relaxed text-muted">
                {profile.headline}
              </p>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <dl className="space-y-3">
              {profile.traits.map((trait) => (
                <div
                  key={trait.label}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line-soft pb-3 last:border-0 last:pb-0"
                >
                  <dt className="text-sm font-medium text-ink">{trait.label}</dt>
                  <dd className="flex items-center gap-3">
                    <LevelMeter level={trait.level} />
                  </dd>
                  <dd className="w-full text-xs leading-relaxed text-muted">
                    {trait.basis}
                  </dd>
                </div>
              ))}
            </dl>

            {profile.strengths.length > 0 || profile.watchouts.length > 0 ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {profile.strengths.length > 0 ? (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-positive">
                      Works well
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {profile.strengths.map((item) => (
                        <li key={item} className="text-sm leading-relaxed text-ink">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {profile.watchouts.length > 0 ? (
                  <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-3">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-caution">
                      Worth attention
                    </p>
                    <ul className="mt-1.5 space-y-1.5">
                      {profile.watchouts.map((item) => (
                        <li key={item} className="text-sm leading-relaxed text-ink">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            <EvidenceDrawer evidence={profile.evidence} messages={messages} />
          </div>
        </div>
      ))}
    </div>
  );
}
