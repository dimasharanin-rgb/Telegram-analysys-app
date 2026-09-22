"use client";

import * as React from "react";
import Link from "next/link";

import { getProduct } from "@/lib/billing/products";
import type { JobDetail, JobResult } from "@/lib/client/api";
import { buildInsightDeck, prioritiseDeck } from "@/lib/client/insights";
import { cx, formatDate, formatNumber } from "@/lib/client/format";
import type { PseudonymMap } from "@/lib/pipeline/payload";

import type { EvidenceLookup, EvidenceMessageView } from "@/components/EvidenceDrawer";
import { StatsDashboard } from "@/components/StatsDashboard";
import { Button } from "@/components/ui/Button";
import { SiteHeader } from "@/components/v2/SiteHeader";
import { AdviceTab } from "@/components/v2/result/AdviceTab";
import { ConflictsTab } from "@/components/v2/result/ConflictsTab";
import {
  BalanceMetrics,
  EmotionalIndicators,
  HabitTable,
} from "@/components/v2/result/BehaviourMetrics";
import { ExportPanel } from "@/components/v2/result/ExportPanel";
import { InsightsTab } from "@/components/v2/result/InsightsTab";
import { ProfilesTab } from "@/components/v2/result/ProfilesTab";
import { TimelineTab } from "@/components/v2/result/TimelineTab";

/**
 * The reading order of a finished analysis.
 *
 * No Dynamics tab: "dynamics" is a category in the data model rather than
 * something a reader goes looking for, and splitting it out meant "how you
 * two fit together" was filed away from "what this conversation is like".
 * Its findings are now in Insights and its measurements in Profile and Stats.
 *
 * Export is a destination rather than a footnote. It used to be a card at the
 * bottom of the Stats tab, which is why it looked like the feature had been
 * removed.
 */
const TABS = [
  { id: "insights", label: "Insights" },
  { id: "timeline", label: "Timeline" },
  { id: "conflicts", label: "Difficult moments" },
  { id: "profiles", label: "Profile" },
  { id: "stats", label: "Stats" },
  { id: "advice", label: "Suggestions" },
  { id: "export", label: "Export" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ResultView({
  detail,
  result,
}: {
  detail: JobDetail;
  result: JobResult;
}) {
  const [tab, setTab] = React.useState<TabId>("insights");

  const participants = result.participants;
  const statistics = result.conversation.statistics;

  /* --- lookups --------------------------------------------------------- */

  const pseudonyms: PseudonymMap = React.useMemo(
    () => ({
      toPseudonym: new Map(participants.map((p) => [p.id, p.pseudonym])),
      toDisplayName: new Map(participants.map((p) => [p.pseudonym, p.displayName])),
    }),
    [participants],
  );

  const colorIndexFor = React.useCallback(
    (pseudonym: string) =>
      Math.max(0, participants.findIndex((p) => p.pseudonym === pseudonym)),
    [participants],
  );

  const nameFor = React.useCallback(
    (pseudonym: string) =>
      participants.find((p) => p.pseudonym === pseudonym)?.displayName ?? pseudonym,
    [participants],
  );

  const messages: EvidenceLookup = React.useMemo(() => {
    const map = new Map<string, EvidenceMessageView>();
    for (const message of result.evidence) {
      map.set(message.id, {
        id: message.id,
        senderName: nameFor(message.participantId),
        iso: message.iso,
        text: message.text,
        colorIndex: colorIndexFor(message.participantId),
      });
    }
    return map;
  }, [result.evidence, nameFor, colorIndexFor]);

  const deck = React.useMemo(
    () =>
      prioritiseDeck(
        buildInsightDeck({
          statistics: statistics.base,
          analysis: result.result.base,
          pseudonyms,
        }),
      ),
    [statistics.base, result.result.base, pseudonyms],
  );

  const product = getProduct(detail.job.productId);
  const adviceAvailable =
    product?.allowedModules.includes("RESPONSE_ADVICE") === true ||
    product?.allowedModules.includes("AVOIDANCE_PATTERNS") === true;

  const statisticsParticipants = participants.map((p) => ({
    id: p.id,
    displayName: p.displayName,
  }));

  return (
    <div className="flex min-h-dvh flex-col pb-20 sm:pb-0">
      <SiteHeader subtitle={result.conversation.title} />

      {/* Result header */}
      <div className="no-print border-b border-line bg-white">
        <div className="app-container py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                {result.conversation.title}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {formatNumber(result.conversation.messageCount)} messages ·{" "}
                {formatDate(result.conversation.startDate)} –{" "}
                {formatDate(result.conversation.endDate)}
                {product ? ` · ${product.name}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* The export lives on its own tab; this is the signpost to it,
                  so the feature is visible from wherever the reader is. */}
              <Button size="sm" onClick={() => setTab("export")}>
                Export PDF
              </Button>
              <Link href="/analyses">
                <Button variant="secondary" size="sm">
                  All analyses
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Tabs. Horizontally scrollable on a phone rather than wrapped. */}
        <div className="app-container">
          <div
            role="tablist"
            aria-label="Analysis sections"
            className="-mx-1 flex gap-1 overflow-x-auto pb-px"
          >
            {TABS.map((entry) => (
              <button
                key={entry.id}
                role="tab"
                type="button"
                aria-selected={tab === entry.id}
                onClick={() => setTab(entry.id)}
                className={cx(
                  "shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                  tab === entry.id
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-muted hover:text-ink",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main id="main" className="app-container flex-1 py-6 sm:py-8">
        <div
          role="tabpanel"
          className={tab === "stats" ? "mx-auto max-w-4xl" : "mx-auto max-w-3xl"}
        >
          {tab === "insights" ? (
            <InsightsTab
              deck={deck}
              interaction={result.result.interaction}
              emotional={result.result.emotional}
              messages={messages}
            />
          ) : null}

          {tab === "profiles" ? (
            <div className="space-y-10">
              <ProfilesTab
                profiles={result.result.profiles}
                nameFor={nameFor}
                colorIndexFor={colorIndexFor}
                messages={messages}
              />
              {/* Measured habits sit under the written profile they describe. */}
              <BalanceMetrics advanced={statistics.advanced} />
              <HabitTable
                advanced={statistics.advanced}
                participants={statisticsParticipants}
              />
            </div>
          ) : null}

          {tab === "timeline" ? (
            <TimelineTab
              timeline={result.result.timeline}
              advanced={statistics.advanced}
              messages={messages}
            />
          ) : null}

          {tab === "conflicts" ? (
            <ConflictsTab
              conflicts={result.result.conflicts}
              advanced={statistics.advanced}
              messages={messages}
            />
          ) : null}

          {tab === "stats" ? (
            <div className="space-y-8">
              <StatsDashboard
                statistics={statistics.base}
                analysis={result.result.base}
                pseudonyms={pseudonyms}
                conversationTitle={result.conversation.title}
                // Export has its own tab now; the dashboard should not also
                // end in an export card.
                exportSlot={<></>}
              />
              <EmotionalIndicators
                advanced={statistics.advanced}
                participants={statisticsParticipants}
              />
            </div>
          ) : null}

          {tab === "export" ? (
            <ExportPanel
              detail={detail}
              result={result}
              pseudonyms={pseudonyms}
              nameFor={nameFor}
            />
          ) : null}

          {tab === "advice" ? (
            <AdviceTab
              jobId={detail.job.id}
              evidence={result.evidence}
              participants={participants.map((p) => ({
                pseudonym: p.pseudonym,
                displayName: p.displayName,
                isSelf: p.isSelf,
              }))}
              available={adviceAvailable}
              allowance={detail.advice}
            />
          ) : null}
        </div>

        <p className="mx-auto mt-10 max-w-3xl border-t border-line pt-5 text-xs leading-relaxed text-faint">
          The figures are exact arithmetic over the export. The written sections are
          interpretation of the conversation, not an assessment of anyone in it. Where a
          reading rests on a judgement call, the rule used is stated beside it.
        </p>
      </main>
    </div>
  );
}
