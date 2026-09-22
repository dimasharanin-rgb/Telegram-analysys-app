"use client";

/**
 * Measured behaviour, computed on the device.
 *
 * These used to live on a Dynamics tab. V3 drops that tab - "dynamics" is a
 * category in the data model, not a thing a reader goes looking for - and
 * puts the numbers where they answer a question someone actually has:
 * balance and per-person habits next to the profile they describe, the
 * emotional word counts inside Stats where the rest of the arithmetic lives.
 *
 * Nothing here is interpretation. Every figure is arithmetic over the export,
 * and the wording says so, because a bar chart is very good at making a word
 * count look like a measurement of a feeling.
 */

import * as React from "react";

import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  INDICATOR_CATEGORIES,
} from "@/lib/stats/lexicon";
import type { AdvancedStatistics } from "@/lib/stats/advanced";
import { formatNumber } from "@/lib/client/format";
import { seriesColor } from "@/lib/palette";
import { SectionTitle } from "@/components/ui/Card";

export interface ParticipantRef {
  id: string;
  displayName: string;
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

/** How evenly the two sides carry the conversation. */
export function BalanceMetrics({ advanced }: { advanced: AdvancedStatistics }) {
  const reciprocity = advanced.interaction.reciprocity;

  return (
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
              {reciprocity.responseTimeRatio > 0 ? `${reciprocity.responseTimeRatio}×` : "—"}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            The slower median reply, divided by the faster one. 1× means they match.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Per-person messaging habits, as counts rather than characterisations. */
export function HabitTable({
  advanced,
  participants,
}: {
  advanced: AdvancedStatistics;
  participants: ParticipantRef[];
}) {
  return (
    <section>
      <SectionTitle hint="Counts, not characterisations">Messaging habits</SectionTitle>
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
        {advanced.methodology.slice(0, 3).map((note) => (
          <li key={note} className="text-xs leading-relaxed text-faint">
            {note}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Emotional-language word counts.
 *
 * Secondary detail, so it opens on request rather than filling the page -
 * and the caption does the work of stopping it being read as a measurement
 * of how anyone felt.
 */
export function EmotionalIndicators({
  advanced,
  participants,
}: {
  advanced: AdvancedStatistics;
  participants: ParticipantRef[];
}) {
  return (
    <details className="group rounded-xl border border-line bg-white">
      <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-ink">
        <span className="flex items-center justify-between gap-3">
          Emotional language indicators
          <span className="text-xs font-normal text-muted group-open:hidden">Show</span>
          <span className="hidden text-xs font-normal text-muted group-open:inline">Hide</span>
        </span>
      </summary>

      <div className="border-t border-line px-5 pb-5 pt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">Indicator</th>
                {participants.map((participant) => (
                  <th key={participant.id} scope="col" className="py-2 pr-4 font-medium">
                    {participant.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INDICATOR_CATEGORIES.map((category) => (
                <tr key={category} className="border-b border-line-soft last:border-0">
                  <th scope="row" className="py-3 pr-4 font-medium text-ink">
                    {CATEGORY_LABELS[category]}
                    <span className="mt-0.5 block text-xs font-normal leading-relaxed text-muted">
                      {CATEGORY_DESCRIPTIONS[category]}
                    </span>
                  </th>
                  {participants.map((participant) => (
                    <td
                      key={participant.id}
                      className="py-3 pr-4 align-top tabular-nums text-ink-soft"
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
        <p className="mt-3 text-xs leading-relaxed text-faint">
          Each figure counts messages containing a word from a fixed list, out of{" "}
          {formatNumber(advanced.emotional.messagesScored)} messages with text. A low
          count can mean the feeling was expressed in words the list does not contain.
        </p>
      </div>
    </details>
  );
}
