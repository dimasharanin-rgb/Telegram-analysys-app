"use client";

import * as React from "react";
import { seriesColor } from "@/lib/palette";

export interface ComparisonEntry {
  id: string;
  name: string;
  /** Drives the bar width. A share, a count, an average - anything comparable. */
  weight: number;
  /** What is printed next to the name, e.g. "50.7%" or "41 chars". */
  valueLabel: string;
  detail: string;
}

export interface ParticipantComparisonProps {
  entries: ComparisonEntry[];
  /**
   * "share" draws one bar split between participants, for quantities that add
   * up to a whole. "each" draws one bar per participant scaled to the largest,
   * for quantities that do not - an average message length is not a slice of
   * anything.
   */
  mode?: "share" | "each";
  /** Shown under the bars when the comparison needs a caveat. */
  note?: string;
}

/**
 * Comparison bars with direct labels.
 *
 * Every segment is labelled with its participant's name and value, so the
 * comparison never depends on telling two blues apart.
 */
export function ParticipantComparison({
  entries,
  mode = "share",
  note,
}: ParticipantComparisonProps) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  const max = Math.max(...entries.map((entry) => entry.weight), 1);

  return (
    <div className="print-block">
      {mode === "share" ? (
        <div
          className="flex h-6 w-full overflow-hidden rounded-md border border-line bg-line-soft"
          role="img"
          aria-label={entries
            .map((entry) => `${entry.name}: ${entry.valueLabel}`)
            .join(", ")}
        >
          {entries.map((entry, index) => (
            <span
              key={entry.id}
              className="h-full"
              style={{
                width: `${(entry.weight / total) * 100}%`,
                backgroundColor: seriesColor(index),
                // A hairline of surface between segments keeps them separable.
                boxShadow: index > 0 ? "-2px 0 0 0 #ffffff" : undefined,
              }}
            />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry, index) => (
            <li key={entry.id} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-sm text-ink-soft">
                {entry.name}
              </span>
              <span className="h-5 flex-1 overflow-hidden rounded bg-line-soft">
                <span
                  className="block h-full rounded"
                  style={{
                    width: `${Math.max(2, (entry.weight / max) * 100)}%`,
                    backgroundColor: seriesColor(index),
                  }}
                />
              </span>
              <span className="min-w-20 text-right text-sm tabular-nums text-ink">
                {entry.valueLabel}
              </span>
            </li>
          ))}
        </ul>
      )}

      {mode === "share" ? (
        <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {entries.map((entry, index) => (
            <li key={entry.id} className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: seriesColor(index) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {entry.name}{" "}
                  <span className="tabular-nums text-brand-700">{entry.valueLabel}</span>
                </span>
                <span className="block text-xs text-muted">{entry.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-2 space-y-1">
          {entries.map((entry) => (
            <li key={entry.id} className="text-xs text-muted">
              <span className="text-ink-soft">{entry.name}</span> · {entry.detail}
            </li>
          ))}
        </ul>
      )}

      {note ? <p className="mt-3 text-xs leading-relaxed text-faint">{note}</p> : null}
    </div>
  );
}
