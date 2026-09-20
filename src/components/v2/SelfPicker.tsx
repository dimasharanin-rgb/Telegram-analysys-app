"use client";

import * as React from "react";

import { formatNumber } from "@/lib/client/format";
import { seriesColor } from "@/lib/palette";
import { SectionTitle } from "@/components/ui/Card";

export interface SelfPickerProps {
  participants: { id: string; name: string; messageCount: number }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Which participant is the person using the app.
 *
 * It matters for more than labelling: everyone who is *not* the uploader needs
 * their own consent before the conversation is analysed, so this answer
 * decides who gets asked.
 */
export function SelfPicker({ participants, selectedId, onSelect }: SelfPickerProps) {
  return (
    <div>
      <SectionTitle hint="Everyone else will be asked for consent">
        Which one is you?
      </SectionTitle>
      <div
        role="radiogroup"
        aria-label="Which participant are you"
        className="grid gap-2 sm:grid-cols-2"
      >
        {participants.map((participant, index) => {
          const active = participant.id === selectedId;
          return (
            <button
              key={participant.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(participant.id)}
              className={
                active
                  ? "flex items-center gap-3 rounded-lg border-2 border-brand-600 bg-brand-50 px-4 py-3 text-left"
                  : "flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 text-left hover:border-brand-200 hover:bg-brand-50/40"
              }
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: seriesColor(index) }}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">
                  {participant.name}
                </span>
                <span className="block text-xs text-muted">
                  {formatNumber(participant.messageCount)} messages
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
