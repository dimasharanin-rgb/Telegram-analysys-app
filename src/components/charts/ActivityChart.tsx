"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ConversationStatistics } from "@/lib/stats";
import { CHART_INK } from "@/lib/palette";
import { formatNumber } from "@/lib/client/format";
import { buildActivitySeries } from "@/lib/client/pdf-payload";
import { AXIS_PROPS, ChartDataTable, ChartTooltip, GRID_PROPS } from "./ChartPrimitives";

export interface ActivityChartProps {
  statistics: ConversationStatistics;
}

/**
 * Message volume over time. One series, so no legend - the heading names it.
 * Buckets widen automatically (day → week → month) so a five-year export does
 * not turn into a smear.
 */
export function ActivityChart({ statistics }: ActivityChartProps) {
  const series = React.useMemo(() => buildActivitySeries(statistics), [statistics]);

  if (series.points.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">No activity to show.</p>;
  }

  const unitLabel =
    series.unit === "day" ? "per day" : series.unit === "week" ? "per week" : "per month";

  return (
    <div>
      <div className="h-56 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series.points} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_INK.bar} stopOpacity={0.22} />
                <stop offset="100%" stopColor={CHART_INK.bar} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey="label"
              {...AXIS_PROPS}
              interval={Math.max(0, Math.floor(series.points.length / 6) - 1)}
              minTickGap={16}
            />
            <YAxis {...AXIS_PROPS} width={44} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: CHART_INK.axis, strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <ChartTooltip
                    title={String(label)}
                    rows={[
                      {
                        label: `Messages ${unitLabel}`,
                        value: formatNumber(Number(payload[0]?.value ?? 0)),
                        color: CHART_INK.bar,
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke={CHART_INK.bar}
              strokeWidth={2}
              fill="url(#activityFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#ffffff" }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <ChartDataTable
        caption={`Messages ${unitLabel}`}
        columns={[series.unit === "month" ? "Month" : "Date", "Messages"]}
        rows={series.points.map((point) => [point.label, point.count])}
      />
    </div>
  );
}
