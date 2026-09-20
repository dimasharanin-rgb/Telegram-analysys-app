"use client";

import * as React from "react";
import type { Analysis } from "@/lib/ai/schema";
import type { ConversationStatistics } from "@/lib/stats";
import { WEEKDAY_LABELS } from "@/lib/stats";
import type { PseudonymMap } from "@/lib/pipeline/payload";
import { buildPdfPayload } from "@/lib/client/pdf-payload";
import {
  formatDate,
  formatDuration,
  formatHour,
  formatNumber,
} from "@/lib/client/format";
import { ActivityChart } from "./charts/ActivityChart";
import { HourChart, WeekdayChart } from "./charts/HourChart";
import { ResponseDistributionChart } from "./charts/ResponseDistributionChart";
import { ParticipantComparison, type ComparisonEntry } from "./ParticipantComparison";
import { PdfExportButton } from "./PdfExportButton";
import { ShareButton } from "./ShareButton";
import { StatCard } from "./StatCard";
import { WordList } from "./WordList";
import { Card, CardBody, SectionTitle } from "./ui/Card";

export interface StatsDashboardProps {
  statistics: ConversationStatistics;
  analysis: Analysis | null;
  pseudonyms: PseudonymMap;
  conversationTitle: string;
}

/** Plain-text summary used by Share / Copy. Aggregates only, never messages. */
export function buildShareSummary(
  statistics: ConversationStatistics,
  title: string,
): string {
  const lines = [
    `Conversation analysis — ${title}`,
    `${formatDate(statistics.general.dateRange.start)} to ${formatDate(statistics.general.dateRange.end)} · ${formatNumber(statistics.general.totalMessages)} messages over ${formatNumber(statistics.general.activeDays)} active days`,
    "",
  ];

  for (const participant of statistics.participants.slice(0, 4)) {
    const share = statistics.general.sharePerParticipant[participant.id] ?? 0;
    const initiation = statistics.initiation.sharePerParticipant[participant.id] ?? 0;
    const median = statistics.response.perParticipant[participant.id]?.medianSeconds ?? 0;
    lines.push(
      `${participant.name}: ${share}% of messages · starts ${initiation}% of conversations · median reply ${formatDuration(median)}`,
    );
  }

  lines.push(
    "",
    `${formatNumber(statistics.initiation.totalConversations)} conversations detected (${statistics.meta.conversationGapMinutes / 60}h gap rule).`,
  );

  if (statistics.words.top.length > 0) {
    lines.push(
      `Most used words: ${statistics.words.top.slice(0, 8).map((word) => word.word).join(", ")}.`,
    );
  }

  return lines.join("\n");
}

export function StatsDashboard({
  statistics,
  analysis,
  pseudonyms,
  conversationTitle,
}: StatsDashboardProps) {
  const [pdfFile, setPdfFile] = React.useState<File | null>(null);
  const participants = statistics.participants.slice(0, 4);

  const messageEntries: ComparisonEntry[] = participants.map((participant) => {
    const share = statistics.general.sharePerParticipant[participant.id] ?? 0;
    return {
      id: participant.id,
      name: participant.name,
      weight: share,
      valueLabel: `${share.toFixed(share % 1 === 0 ? 0 : 1)}%`,
      detail: `${formatNumber(statistics.general.perParticipant[participant.id] ?? 0)} messages`,
    };
  });

  const initiationEntries: ComparisonEntry[] = participants.map((participant) => {
    const share = statistics.initiation.sharePerParticipant[participant.id] ?? 0;
    return {
      id: participant.id,
      name: participant.name,
      weight: share,
      valueLabel: `${share.toFixed(share % 1 === 0 ? 0 : 1)}%`,
      detail: `${formatNumber(statistics.initiation.perParticipant[participant.id] ?? 0)} of ${formatNumber(statistics.initiation.totalConversations)} conversations`,
    };
  });

  // Average length is not a share of anything, so it gets its own bar each.
  const lengthEntries: ComparisonEntry[] = participants.map((participant) => {
    const length = statistics.general.lengthPerParticipant[participant.id];
    const average = length?.averageCharacters ?? 0;
    return {
      id: participant.id,
      name: participant.name,
      weight: average,
      valueLabel: `${Math.round(average)} chars`,
      detail: `median ${Math.round(length?.medianCharacters ?? 0)} chars · ${length?.averageWords ?? 0} words on average`,
    };
  });

  const summary = buildShareSummary(statistics, conversationTitle);

  const payload = () =>
    buildPdfPayload({ statistics, analysis, pseudonyms, conversationTitle });

  return (
    <div className="space-y-6">
      {/* Conversation ------------------------------------------------- */}
      <section>
        <SectionTitle
          hint={`${formatDate(statistics.general.dateRange.start)} – ${formatDate(statistics.general.dateRange.end)}`}
        >
          Conversation
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Total messages"
            value={formatNumber(statistics.general.totalMessages)}
            emphasis
          />
          <StatCard
            label="Active days"
            value={formatNumber(statistics.general.activeDays)}
            detail={`of ${formatNumber(statistics.general.dateRange.spanDays)} days covered`}
          />
          <StatCard
            label="Conversations"
            value={formatNumber(statistics.initiation.totalConversations)}
            detail={`${statistics.initiation.averageMessagesPerConversation} messages each`}
          />
          <StatCard
            label="Per active day"
            value={formatNumber(statistics.general.averageMessagesPerActiveDay)}
          />
        </div>
      </section>

      {/* Who talks more ------------------------------------------------ */}
      <Card>
        <CardBody>
          <SectionTitle>Who talks more?</SectionTitle>
          <ParticipantComparison
            entries={messageEntries}
            note="Message count is not the same as how much someone says — one long message and five short ones are not equivalent."
          />
        </CardBody>
      </Card>

      {/* Who starts ---------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionTitle>Who starts conversations?</SectionTitle>
          <ParticipantComparison
            entries={initiationEntries}
            note={statistics.initiation.algorithm}
          />
        </CardBody>
      </Card>

      {/* Response time ------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionTitle hint="Median, then average">Response time</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {participants.map((participant) => {
              const stats = statistics.response.perParticipant[participant.id];
              return (
                <StatCard
                  key={participant.id}
                  label={participant.name}
                  value={formatDuration(stats?.medianSeconds ?? 0)}
                  detail={
                    stats && stats.count > 0
                      ? `average ${formatDuration(stats.averageSeconds)} · ${formatNumber(stats.count)} replies measured`
                      : "not enough replies to measure"
                  }
                />
              );
            })}
          </div>
          <div className="mt-6">
            <ResponseDistributionChart statistics={statistics} />
          </div>
        </CardBody>
      </Card>

      {/* Message length ------------------------------------------------ */}
      <Card>
        <CardBody>
          <SectionTitle
            hint={`Overall median ${Math.round(statistics.general.length.medianCharacters)} chars`}
          >
            Message length
          </SectionTitle>
          <ParticipantComparison
            entries={lengthEntries}
            mode="each"
            note="Average characters per message, counting captions on media messages and ignoring messages with no text."
          />
        </CardBody>
      </Card>

      {/* Activity ------------------------------------------------------ */}
      <Card>
        <CardBody>
          <SectionTitle hint="Messages over time">Activity</SectionTitle>
          <ActivityChart statistics={statistics} />
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardBody>
            <SectionTitle
              hint={
                statistics.time.busiestHour !== null
                  ? `Peak ${formatHour(statistics.time.busiestHour)}`
                  : undefined
              }
            >
              Time of day
            </SectionTitle>
            <HourChart statistics={statistics} />
            <p className="mt-2 text-xs text-faint">
              {statistics.meta.timezoneOffsetMinutes === null
                ? "This export carried no timezone, so times are read exactly as written."
                : "Times are shown in the export's own timezone."}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <SectionTitle
              hint={
                statistics.time.busiestWeekday !== null
                  ? `Busiest ${WEEKDAY_LABELS[statistics.time.busiestWeekday]}`
                  : undefined
              }
            >
              Day of week
            </SectionTitle>
            <WeekdayChart statistics={statistics} />
          </CardBody>
        </Card>
      </div>

      {/* Words --------------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionTitle
            hint={`${formatNumber(statistics.words.uniqueWords)} distinct meaningful words`}
          >
            Most used words
          </SectionTitle>
          <WordList words={statistics.words.top.slice(0, 20)} />
          {statistics.words.phrases.length > 0 ? (
            <div className="mt-5">
              <p className="text-[0.7rem] font-medium uppercase tracking-wide text-muted">
                Recurring phrases
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {statistics.words.phrases.map((phrase) => (
                  <li
                    key={phrase.phrase}
                    className="rounded-full border border-line bg-canvas-soft px-3 py-1 text-sm text-ink-soft"
                  >
                    {phrase.phrase}
                    <span className="ml-1.5 text-xs tabular-nums text-faint">
                      {phrase.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-4 text-xs text-faint">
            Common filler words are removed before ranking.
          </p>
        </CardBody>
      </Card>

      {/* Export -------------------------------------------------------- */}
      <Card className="no-print">
        <CardBody>
          <SectionTitle>Export &amp; share</SectionTitle>
          <p className="mb-4 text-sm leading-relaxed text-muted">
            The PDF contains these statistics and the AI overview — not your messages.
            There is no shareable link: nothing about this conversation is published.
          </p>
          <div className="flex flex-wrap items-start gap-3">
            <PdfExportButton buildPayload={payload} onGenerated={setPdfFile} />
            <ShareButton summary={summary} file={pdfFile} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
