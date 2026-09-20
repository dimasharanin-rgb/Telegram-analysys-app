"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ConversationStatistics } from "@/lib/stats";
import { WEEKDAY_LABELS } from "@/lib/stats";
import { CHART_INK } from "@/lib/palette";
import { formatHour, formatNumber } from "@/lib/client/format";
import { AXIS_PROPS, ChartDataTable, ChartTooltip, GRID_PROPS } from "./ChartPrimitives";

/** Messages by hour of the day, in the export's own timezone. */
export function HourChart({ statistics }: { statistics: ConversationStatistics }) {
  const data = statistics.time.byHour.map((count, hour) => ({
    hour,
    label: String(hour).padStart(2, "0"),
    count,
  }));

  return (
    <div>
      <div className="h-44 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...AXIS_PROPS} interval={2} />
            <YAxis {...AXIS_PROPS} width={44} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "#f1f5f9" }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <ChartTooltip
                    title={formatHour(Number(payload[0]?.payload?.hour ?? 0))}
                    rows={[
                      {
                        label: "Messages",
                        value: formatNumber(Number(payload[0]?.value ?? 0)),
                        color: CHART_INK.bar,
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Bar dataKey="count" fill={CHART_INK.bar} radius={[4, 4, 0, 0]} maxBarSize={18}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        caption="Messages by hour of day"
        columns={["Hour", "Messages"]}
        rows={data.map((point) => [formatHour(point.hour), point.count])}
      />
    </div>
  );
}

/** Messages by weekday, Monday first. */
export function WeekdayChart({ statistics }: { statistics: ConversationStatistics }) {
  const data = statistics.time.byWeekday.map((count, index) => ({
    label: WEEKDAY_LABELS[index]?.slice(0, 3) ?? "",
    full: WEEKDAY_LABELS[index] ?? "",
    count,
  }));

  return (
    <div>
      <div className="h-44 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} width={44} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "#f1f5f9" }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <ChartTooltip
                    title={String(payload[0]?.payload?.full ?? "")}
                    rows={[
                      {
                        label: "Messages",
                        value: formatNumber(Number(payload[0]?.value ?? 0)),
                        color: CHART_INK.bar,
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Bar dataKey="count" fill={CHART_INK.bar} radius={[4, 4, 0, 0]} maxBarSize={34}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        caption="Messages by weekday"
        columns={["Weekday", "Messages"]}
        rows={data.map((point) => [point.full, point.count])}
      />
    </div>
  );
}
