"use client";

/**
 * Insights.
 *
 * The flashcard deck stays: one finding at a time is the right way to read
 * these, and it is the part of the product people remember. What changes in
 * V3 is what sits under it.
 *
 * The interaction and emotional-language findings used to be on a Dynamics
 * tab of their own, which meant a reader had to know that "how you two fit
 * together" was filed separately from "what this conversation is like". They
 * are findings, so they belong with the findings. By the time they arrive
 * here the pipeline has already removed any that restate a card in the deck,
 * so this is additional reading rather than the same reading again.
 */

import * as React from "react";

import type { EmotionalFindings, InteractionFindings } from "@/lib/ai/modules/schemas";
import type { EvidenceLookup } from "@/components/EvidenceDrawer";
import type { prioritiseDeck } from "@/lib/client/insights";
import { InsightDeck } from "@/components/InsightDeck";
import { SectionTitle } from "@/components/ui/Card";
import { FindingCard } from "./FindingCard";

export interface InsightsTabProps {
  deck: ReturnType<typeof prioritiseDeck>;
  interaction: InteractionFindings | null;
  emotional: EmotionalFindings | null;
  messages: EvidenceLookup;
}

export function InsightsTab({ deck, interaction, emotional, messages }: InsightsTabProps) {
  const extra = [
    ...(interaction?.patterns ?? []).map((pattern) => ({
      key: `interaction:${pattern.title}`,
      title: pattern.title,
      observation: pattern.observation,
      interpretation: pattern.interpretation,
      uncertainty: pattern.uncertainty,
      confidence: pattern.confidence,
      evidence: pattern.evidence,
    })),
    ...(emotional?.observations ?? []).map((observation) => ({
      key: `emotional:${observation.title}`,
      title: observation.title,
      observation: observation.observation,
      interpretation: observation.interpretation,
      uncertainty: observation.uncertainty,
      confidence: observation.confidence,
      evidence: observation.evidence,
    })),
  ];

  return (
    <div className="space-y-10">
      <div className="mx-auto max-w-2xl">
        <p className="mb-6 text-sm leading-relaxed text-muted">
          One finding per card, each labelled as a measured figure or an AI reading.
          Open the evidence to see the messages behind it.
        </p>
        <InsightDeck primary={deck.primary} extra={deck.extra} messages={messages} />
      </div>

      {extra.length > 0 ? (
        <section className="mx-auto max-w-2xl">
          <SectionTitle hint="AI interpretation">More findings</SectionTitle>
          <div className="space-y-4">
            {extra.map((finding) => (
              <FindingCard
                key={finding.key}
                title={finding.title}
                observation={finding.observation}
                interpretation={finding.interpretation}
                uncertainty={finding.uncertainty}
                confidence={finding.confidence}
                evidence={finding.evidence}
                messages={messages}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
