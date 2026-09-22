"use client";

import * as React from "react";

import { CONSENT_STATUS_LABELS } from "@/lib/consent/state";
import { CONSENT_DOCUMENT_VERSION } from "@/lib/consent/document";
import { MODULE_DEFINITIONS } from "@/lib/analysis/modules";
import { getProduct } from "@/lib/billing/products";
import type { JobDetail, JobResult } from "@/lib/client/api";
import { buildPdfPayload } from "@/lib/client/pdf-payload";
import { humanise, type PseudonymMap } from "@/lib/pipeline/payload";
import type { PdfReportPayload } from "@/lib/pdf/payload";
import { buildShareSummary } from "@/components/StatsDashboard";
import { PdfExportButton } from "@/components/PdfExportButton";
import { ShareButton } from "@/components/ShareButton";
import { Card, CardBody, SectionTitle } from "@/components/ui/Card";

export const APP_VERSION = "2.0";

export interface ExportPanelProps {
  detail: JobDetail;
  result: JobResult;
  pseudonyms: PseudonymMap;
  nameFor: (pseudonym: string) => string;
}

/**
 * Export and share.
 *
 * The PDF carries the analysis, not the conversation: aggregate statistics,
 * the written sections, and a handful of quoted exchanges. It also carries the
 * consent record reference, because a report someone may pass on should say
 * what it was produced under.
 */
export function ExportPanel({ detail, result, pseudonyms, nameFor }: ExportPanelProps) {
  const [pdfFile, setPdfFile] = React.useState<File | null>(null);

  const statistics = result.conversation.statistics;
  const analysis = result.result;
  const text = React.useCallback(
    (value: string) => humanise(value, pseudonyms.toDisplayName),
    [pseudonyms],
  );

  const buildPayload = (): PdfReportPayload => {
    const base = buildPdfPayload({
      statistics: statistics.base,
      analysis: analysis.base,
      pseudonyms,
      conversationTitle: result.conversation.title,
    });

    // A few quoted exchanges, grouped by the message they were cited from.
    const evidence = result.evidence.slice(0, 24);
    const groups: PdfReportPayload["evidence"] = [];
    for (let index = 0; index < evidence.length; index += 4) {
      const lines = evidence.slice(index, index + 4);
      const first = lines[0];
      if (!first) continue;
      groups.push({
        label: first.iso.slice(0, 10),
        lines: lines.map((message) => ({
          speaker: nameFor(message.participantId).slice(0, 80),
          text: message.text.slice(0, 600),
        })),
      });
      if (groups.length >= 4) break;
    }

    const consentParticipants = detail.gate.requirements
      .filter((requirement) => requirement.required)
      .map((requirement) => ({
        name: requirement.displayName.slice(0, 80),
        status: requirement.status
          ? CONSENT_STATUS_LABELS[requirement.status]
          : "Not requested",
        decidedAt: null,
      }));

    return {
      ...base,
      appVersion: APP_VERSION,
      analysisType: getProduct(detail.job.productId)?.name ?? detail.job.productId,
      methodology: [
        ...base.methodology,
        `Modules run: ${detail.job.modules
          .map((id) => MODULE_DEFINITIONS[id]?.name ?? id)
          .join(", ")}.`,
        ...statistics.advanced.methodology.slice(0, 3),
      ].slice(0, 12),

      keyInsights: analysis.base.patterns.slice(0, 6).map((pattern) => ({
        title: text(pattern.title).slice(0, 120),
        observation: text(pattern.observation).slice(0, 600),
        interpretation: text(pattern.interpretation).slice(0, 700),
        uncertainty: text(pattern.uncertainty).slice(0, 500),
      })),

      suggestions: analysis.base.suggestions.slice(0, 5).map((suggestion) => ({
        title: text(suggestion.title).slice(0, 120),
        doThis: text(suggestion.do).slice(0, 400),
        avoidThis: text(suggestion.avoid).slice(0, 400),
      })),

      ...(analysis.profiles
        ? {
            profiles: analysis.profiles.profiles.map((profile) => ({
              name: nameFor(profile.participantId).slice(0, 80),
              headline: text(profile.headline).slice(0, 200),
              traits: profile.traits.slice(0, 8).map((trait) => ({
                label: trait.label.slice(0, 60),
                level: trait.level,
                basis: text(trait.basis).slice(0, 300),
              })),
              strengths: profile.strengths.slice(0, 4).map((item) => text(item).slice(0, 300)),
              watchouts: profile.watchouts.slice(0, 4).map((item) => text(item).slice(0, 300)),
            })),
          }
        : {}),

      ...(analysis.interaction
        ? {
            interactionPatterns: analysis.interaction.patterns.slice(0, 5).map((pattern) => ({
              title: text(pattern.title).slice(0, 120),
              observation: text(pattern.observation).slice(0, 600),
              interpretation: text(pattern.interpretation).slice(0, 700),
            })),
          }
        : {}),

      ...(analysis.timeline
        ? {
            timelineChanges: analysis.timeline.changes.slice(0, 6).map((change) => ({
              title: text(change.title).slice(0, 120),
              earlier: text(change.earlier).slice(0, 400),
              later: text(change.later).slice(0, 400),
            })),
          }
        : {}),

      ...(analysis.conflicts
        ? {
            conflicts: analysis.conflicts.conflicts.slice(0, 5).map((conflict) => ({
              title: text(conflict.title).slice(0, 120),
              trigger: text(conflict.trigger).slice(0, 500),
              repair: text(conflict.repair).slice(0, 500),
              resolution: conflict.resolution,
            })),
          }
        : {}),

      evidence: groups,
      consent:
        consentParticipants.length > 0
          ? {
              documentVersion: CONSENT_DOCUMENT_VERSION,
              participants: consentParticipants,
            }
          : null,
    };
  };

  const summary = buildShareSummary(statistics.base, result.conversation.title);

  const analysisResult = result.result;
  const contents = [
    "Participants, date range and the analysis type",
    "The overview and the key insights",
    ...(analysisResult.profiles ? ["Communication profiles"] : []),
    ...(analysisResult.timeline ? ["What changed over time"] : []),
    ...(analysisResult.conflicts ? ["Difficult moments"] : []),
    "Statistics: who talks more, who starts, response times, activity",
    "Suggestions",
    "A handful of quoted exchanges as evidence",
    "The consent record this analysis ran under",
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Export this analysis</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          A typeset PDF of the report — the statistics, the written sections and a
          small number of quoted exchanges. Not your conversation, and no internal
          references.
        </p>
      </div>

      <Card>
        <CardBody className="sm:px-6 sm:py-6">
          <SectionTitle>What the PDF contains</SectionTitle>
          <ul className="space-y-2 text-sm leading-relaxed text-ink-soft">
            {contents.map((entry) => (
              <li key={entry} className="flex gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                />
                <span>{entry}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-start gap-3">
            <PdfExportButton buildPayload={buildPayload} onGenerated={setPdfFile} />
            <ShareButton summary={summary} file={pdfFile} />
          </div>

          {pdfFile ? (
            <p className="mt-4 text-sm text-positive" role="status">
              Saved as {pdfFile.name}.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <p className="text-xs leading-relaxed text-faint">
        There is no shareable link: nothing about this conversation is published.
        Sharing means this file, or a copied text summary.
      </p>
    </div>
  );
}
