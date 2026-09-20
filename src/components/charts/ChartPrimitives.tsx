"use client";

import * as React from "react";
import { CHART_INK } from "@/lib/palette";

export const AXIS_PROPS = {
  stroke: CHART_INK.axis,
  tickLine: false,
  axisLine: false,
  tick: { fill: CHART_INK.label, fontSize: 11 },
} as const;

export const GRID_PROPS = {
  stroke: CHART_INK.grid,
  strokeDasharray: "0",
  vertical: false,
} as const;

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

/** One tooltip shape for every chart: small, bordered, no drop shadow stack. */
export function ChartTooltip({
  title,
  rows,
}: {
  title: string;
  rows: TooltipRow[];
}) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-ink">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 text-muted">
            {row.color ? (
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: row.color }}
              />
            ) : null}
            <span>{row.label}</span>
            <span className="ml-auto font-medium tabular-nums text-ink">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Accessible fallback for every chart: the same numbers as a table, visually
 * hidden but reachable by screen readers and by anyone who opens the details.
 */
export function ChartDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-muted hover:text-ink">
        View as table
      </summary>
      <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-line">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-canvas-soft text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="px-3 py-2 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-line">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-1.5 tabular-nums text-ink-soft">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
