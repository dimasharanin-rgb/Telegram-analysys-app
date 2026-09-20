"use client";

import * as React from "react";

import type { EmotionalFindings, InteractionFindings } from "@/lib/ai/modules/schemas";
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, INDICATOR_CATEGORIES } from "@/lib/stats/lexicon";
import type { AdvancedStatistics } from "@/lib/stats/advanced";
import type { EvidenceLookup } from "@/components/EvidenceDrawer";
import { formatNumber } from "@/lib/client/format";
import { seriesColor } from "@/lib/palette";
import { SectionTitle } from "@/components/ui/Card";
import { EmptyModule, FindingCard } from "./FindingCard";

export interface DynamicsTabProps {
  interaction: InteractionFindings | null;
  emotional: EmotionalFindings | null;
  advanced: AdvancedStatistics;
  participants: { id: string; displayName: string }[];
  messages: EvidenceLookup;
}

/** A 0–1 balance figure, drawn so "even" reads as even. */
function BalanceBar({ label, value, note }: { label: string; value: number; note: string }) {
  const percent = Math.round(value * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-sm tabular-nums text-brand-700">{percent}% even</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line-soft">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

export function DynamicsTab({
  interaction,
  emotional,
  advanced,
  participants,
  messages,
}: DynamicsTabProps) {
  const reciprocity = advanced.interaction.reciprocity;

  return (
    <div className="space-y-8">
      {/* Measured first: these are arithmetic, not interpretation. */}
      <section>
        <SectionTitle hint="Computed on your device">Balance</SectionTitle>
        <div className="grid gap-5 rounded-xl border border-line bg-white px-5 py-5 sm:grid-cols-2 sm:px-6">
          <BalanceBar
            label="Messages"
            value={reciprocity.messageBalance}
            note="How evenly the messages are split."
          />
          <BalanceBar
            label="Starting conversations"
            value={reciprocity.initiationBalance}
            note="How evenly conversations are opened."
          />
          <BalanceBar
            label="Message length"
            value={reciprocity.lengthBalance}
            note="How close the average message lengths are."
          />
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-ink">Reply speed gap</span>
              <span className="text-sm tabular-nums text-brand-700">
                {reciprocity.responseTimeRatio > 0
                  ? `${reciprocity.responseTimeRatio}×`
                  : "—"}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              The slower median reply, divided by the faster one. 1× means they match.
            </p>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>Per person</SectionTitle>
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas-soft text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Person</th>
                <th scope="col" className="px-4 py-3 font-medium">Double texts</th>
                <th scope="col" className="px-4 py-3 font-medium">Bursts of 3+</th>
                <th scope="col" className="px-4 py-3 font-medium">Ended unanswered</th>
                <th scope="col" className="px-4 py-3 font-medium">Questions answered</th>
                <th scope="col" className="px-4 py-3 font-medium">Vocabulary</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant, index) => {
                const stats = advanced.interaction.perParticipant[participant.id];
                if (!stats) return null;
                return (
                  <tr key={participant.id} className="border-b border-line-soft last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium text-ink">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: seriesColor(index) }}
                        />
                        {participant.displayName}
                      </span>
                    </th>
                    <td className="px-4 py-3 tabular-nums text-ink-soft">
                      {formatNumber(stats.doubleTexts)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-soft">
                      {formatNumber(stats.bursts)}
                      <span className="ml-1 text-xs text-faint">
                        (longest {stats.longestRun})
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-soft">
                      {formatNumber(stats.unansweredEndings)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-soft">
                      {stats.questionAnswerRate}%
                      <span className="ml-1 text-xs text-faint">
                        of {formatNumber(stats.questionsAsked)}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-soft">
                      {stats.vocabularyDiversity}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 space-y-1">
          {advanced.methodology.slice(0, 4).map((note) => (
            <li key={note} className="text-xs leading-relaxed text-faint">
              {note}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle hint="AI interpretation">How the two sides fit together</SectionTitle>
        {interaction ? (
          <div className="space-y-4">
            <p className="text-[0.95rem] leading-relaxed text-ink-soft">
              {interaction.summary}
            </p>
            {interaction.patterns.map((pattern) => (
              <FindingCard
                key={pattern.title}
                title={pattern.title}
                observation={pattern.observation}
                interpretation={pattern.interpretation}
                uncertainty={pattern.uncertainty}
                confidence={pattern.confidence}
                evidence={pattern.evidence}
                messages={messages}
              />
            ))}
          </div>
        ) : (
          <EmptyModule
            title="Interaction dynamics were not included"
            reason="This module comes with the deep text analysis."
          />
        )}
      </section>

      <section>
        <SectionTitle hint="Word counts, not feelings">Emotional language</SectionTitle>
        <div className="mb-4 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas-soft text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Indicator</th>
                {participants.map((participant) => (
                  <th key={participant.id} scope="col" className="px-4 py-3 font-medium">
                    {participant.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INDICATOR_CATEGORIES.map((category) => (
                <tr key={category} className="border-b border-line-soft last:border-0">
                  <th scope="row" className="px-4 py-3 font-medium text-ink">
                    {CATEGORY_LABELS[category]}
                    <span className="mt-0.5 block text-xs font-normal leading-relaxed text-muted">
                      {CATEGORY_DESCRIPTIONS[category]}
                    </span>
                  </th>
                  {participants.map((participant) => (
                    <td
                      key={participant.id}
                      className="px-4 py-3 align-top tabular-nums text-ink-soft"
                    >
                      {formatNumber(
                        advanced.emotional.perParticipant[participant.id]?.[category] ?? 0,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-faint">
          Each figure counts messages containing a word from a fixed list, out of{" "}
          {formatNumber(advanced.emotional.messagesScored)} messages with text. A low
          count can mean the feeling was expressed in words the list does not contain.
        </p>

        {emotional ? (
          <div className="space-y-4">
            <p className="text-[0.95rem] leading-relaxed text-ink-soft">
              {emotional.summary}
            </p>
            {emotional.observations.map((observation) => (
              <FindingCard
                key={observation.title}
                title={observation.title}
                observation={observation.observation}
                interpretation={observation.interpretation}
                uncertainty={observation.uncertainty}
                confidence={observation.confidence}
                evidence={observation.evidence}
                messages={messages}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
