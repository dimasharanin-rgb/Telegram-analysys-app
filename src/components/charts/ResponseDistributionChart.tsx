"use client";

import * as React from "react";
import type { ConversationStatistics } from "@/lib/stats";
import { formatNumber } from "@/lib/client/format";
import { ChartDataTable } from "./ChartPrimitives";

/**
 * Response-time distribution.
 *
 * Six buckets is few enough to direct-label every bar, so this is drawn as
 * plain HTML rather than a chart library: no axis to read, no tooltip to hunt
 * for, and it stays legible at phone width.
 */
export function ResponseDistributionChart({
  statistics,
}: {
  statistics: ConversationStatistics;
}) {
  const buckets = statistics.response.distribution;
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  if (total === 0) {
    return (
      <p className="py-6 text-sm text-muted">
        Not enough back-and-forth in this conversation to measure reply times.
      </p>
    );
  }

  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);

  return (
    <div>
      <ul className="space-y-2.5">
        {buckets.map((bucket) => {
          const share = (bucket.count / total) * 100;
          return (
            <li key={bucket.id} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3">
              <span className="text-xs text-muted">{bucket.label}</span>
              <span className="h-5 overflow-hidden rounded bg-line-soft">
                <span
                  className="block h-full rounded bg-brand-600 transition-[width] duration-300"
                  style={{ width: `${Math.max(1.5, (bucket.count / max) * 100)}%` }}
                />
              </span>
              <span className="min-w-16 text-right text-xs tabular-nums text-ink-soft">
                {formatNumber(bucket.count)}
                <span className="ml-1 text-faint">({share.toFixed(0)}%)</span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-faint">
        Based on {formatNumber(total)} replies inside a conversation. Gaps that cross a
        conversation boundary are excluded.
      </p>

      <ChartDataTable
        caption="Response time distribution"
        columns={["Reply time", "Replies", "Share"]}
        rows={buckets.map((bucket) => [
          bucket.label,
          bucket.count,
          `${((bucket.count / total) * 100).toFixed(1)}%`,
        ])}
      />
    </div>
  );
}
