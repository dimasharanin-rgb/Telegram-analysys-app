"use client";

import * as React from "react";

import type { ConflictFindings } from "@/lib/ai/modules/schemas";
import type { AdvancedStatistics } from "@/lib/stats/advanced";
import type { EvidenceLookup } from "@/components/EvidenceDrawer";
import { formatDate, formatDuration } from "@/lib/client/format";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/Card";
import { EmptyModule, FindingCard } from "./FindingCard";

const RESOLUTION_TONE = {
  resolved: "positive",
  paused: "neutral",
  unresolved: "caution",
  unclear: "neutral",
} as const;

const RESOLUTION_LABEL = {
  resolved: "Appears resolved",
  paused: "Paused",
  unresolved: "Appears unresolved",
  unclear: "Unclear",
} as const;

export function ConflictsTab({
  conflicts,
  advanced,
  messages,
}: {
  conflicts: ConflictFindings | null;
  advanced: AdvancedStatistics;
  messages: EvidenceLookup;
}) {
  const candidates = advanced.conflictCandidates;

  if (candidates.length === 0) {
    return (
      <EmptyModule
        title="No difficult moments were shortlisted"
        reason="The local heuristic looks for tension and absolute wording, long messages, and the silence that follows an exchange. It found none of that here. That is not the same as there having been no disagreements."
      />
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle hint={`${candidates.length} shortlisted`}>
          What was shortlisted
        </SectionTitle>
        <p className="mb-4 text-sm leading-relaxed text-muted">
          A scoring heuristic running on your device nominated these exchanges from
          wording, pacing and the silence that followed. It decides where to look; it
          does not decide that an argument happened.
        </p>
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-ink">
                  {formatDate(candidate.startIso.slice(0, 10))}
                </span>
                <span className="text-xs text-muted">
                  {candidate.followedBySilenceSeconds > 3600
                    ? `${formatDuration(candidate.followedBySilenceSeconds)} of silence afterwards`
                    : "no notable silence afterwards"}
                  {candidate.repairFollowed ? " · apology in the next conversation" : ""}
                </span>
              </div>
              {candidate.signals.length > 0 ? (
                <p className="mt-1 text-xs leading-relaxed text-faint">
                  {candidate.signals.join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {conflicts ? (
        <section>
          <SectionTitle hint="AI interpretation">Reading the exchanges</SectionTitle>
          <p className="mb-4 text-[0.95rem] leading-relaxed text-ink-soft">
            {conflicts.summary}
          </p>

          {conflicts.conflicts.length === 0 ? (
            <EmptyModule
              title="None of the shortlisted exchanges were disagreements"
              reason="The shortlist is deliberately broad, and every entry was looked at and set aside."
            />
          ) : (
            <div className="space-y-4">
              {conflicts.conflicts.map((conflict) => (
                <FindingCard
                  key={conflict.candidateId}
                  title={conflict.title}
                  confidence={conflict.confidence}
                  evidence={conflict.evidence}
                  messages={messages}
                >
                  <div className="space-y-3">
                    <Row label="What it starts from">{conflict.trigger}</Row>
                    {conflict.escalation ? (
                      <Row label="How it develops">{conflict.escalation}</Row>
                    ) : null}
                    {conflict.responses.length > 0 ? (
                      <div className="border-l-2 border-line pl-4">
                        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted">
                          How each responds
                        </p>
                        <ul className="mt-1 space-y-1">
                          {conflict.responses.map((response) => (
                            <li key={response.participant} className="text-ink-soft">
                              <span className="font-medium text-ink">
                                {response.participant}:
                              </span>{" "}
                              {response.description}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {conflict.repair ? (
                      <Row label="Repair">{conflict.repair}</Row>
                    ) : null}
                    {conflict.recurrence ? (
                      <Row label="Does it come back?">{conflict.recurrence}</Row>
                    ) : null}
                    <div className="pt-1">
                      <Badge tone={RESOLUTION_TONE[conflict.resolution]}>
                        {RESOLUTION_LABEL[conflict.resolution]}
                      </Badge>
                    </div>
                  </div>
                </FindingCard>
              ))}
            </div>
          )}
        </section>
      ) : (
        <EmptyModule
          title="Difficult moments were not analysed"
          reason="This module comes with the deep text analysis."
        />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-line pl-4">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-muted">
        {label}
      </p>
      <p className="mt-1 text-ink-soft">{children}</p>
    </div>
  );
}
