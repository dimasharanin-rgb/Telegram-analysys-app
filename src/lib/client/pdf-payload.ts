/**
 * Builds the PDF report payload from the local statistics.
 *
 * Only aggregate figures travel: counts, shares, response times, an activity
 * series and the top words. No message text, no evidence excerpts - a report
 * that might be emailed should not carry the conversation inside it.
 */

import type { Analysis } from "@/lib/ai/schema";
import type { PdfReportPayload } from "@/lib/pdf/payload";
import { humanise, type PseudonymMap } from "@/lib/pipeline/payload";
import type { ConversationStatistics } from "@/lib/stats";
import { formatDate, formatMonth } from "./format";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** `2024-01-08` → `8 Jan`, which reads the same everywhere. */
function shortDayLabel(isoDate: string): string {
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  const abbr = MONTH_ABBR[month - 1];
  return abbr ? `${day} ${abbr}` : isoDate;
}

const MAX_ACTIVITY_POINTS = 48;

interface ActivitySeries {
  points: { label: string; count: number }[];
  unit: "day" | "week" | "month";
}

/** Picks the coarsest bucket that still shows shape without crowding. */
export function buildActivitySeries(statistics: ConversationStatistics): ActivitySeries {
  const daily = statistics.time.daily;

  if (daily.length <= MAX_ACTIVITY_POINTS) {
    return {
      unit: "day",
      points: daily.map((point) => ({
        label: shortDayLabel(point.date),
        count: point.count,
      })),
    };
  }

  const weeks = new Map<string, number>();
  for (const point of daily) {
    const ms = Date.parse(`${point.date}T00:00:00Z`);
    if (!Number.isFinite(ms)) continue;
    const date = new Date(ms);
    // Snap to the Monday of that week.
    const offset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    weeks.set(key, (weeks.get(key) ?? 0) + point.count);
  }

  if (weeks.size <= MAX_ACTIVITY_POINTS) {
    return {
      unit: "week",
      points: [...weeks.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, count]) => ({ label: shortDayLabel(date), count })),
    };
  }

  return {
    unit: "month",
    points: statistics.time.monthly.slice(-MAX_ACTIVITY_POINTS).map((point) => ({
      label: formatMonth(point.month),
      count: point.count,
    })),
  };
}

export function buildPdfPayload(options: {
  statistics: ConversationStatistics;
  analysis: Analysis | null;
  pseudonyms: PseudonymMap;
  conversationTitle: string;
}): PdfReportPayload {
  const { statistics, analysis, pseudonyms, conversationTitle } = options;
  const activity = buildActivitySeries(statistics);

  return {
    generatedAt: new Date().toISOString(),
    conversationTitle: conversationTitle.slice(0, 120),
    dateRange: {
      start: statistics.general.dateRange.start,
      end: statistics.general.dateRange.end,
      spanDays: statistics.general.dateRange.spanDays,
    },
    totals: {
      messages: statistics.general.totalMessages,
      activeDays: statistics.general.activeDays,
      averagePerActiveDay: statistics.general.averageMessagesPerActiveDay,
      conversations: statistics.initiation.totalConversations,
      averageMessagesPerConversation:
        statistics.initiation.averageMessagesPerConversation,
      mediaMessages: statistics.meta.mediaMessages,
    },
    participants: statistics.participants.slice(0, 4).map((participant) => ({
      id: participant.id.slice(0, 64),
      name: participant.name.slice(0, 80),
      messages: statistics.general.perParticipant[participant.id] ?? 0,
      sharePercent: statistics.general.sharePerParticipant[participant.id] ?? 0,
      initiations: statistics.initiation.perParticipant[participant.id] ?? 0,
      initiationSharePercent:
        statistics.initiation.sharePerParticipant[participant.id] ?? 0,
      medianResponseSeconds:
        statistics.response.perParticipant[participant.id]?.medianSeconds ?? 0,
      averageResponseSeconds:
        statistics.response.perParticipant[participant.id]?.averageSeconds ?? 0,
      averageMessageCharacters:
        statistics.general.lengthPerParticipant[participant.id]?.averageCharacters ?? 0,
    })),
    activity: activity.points,
    activityUnit: activity.unit,
    topWords: statistics.words.top.slice(0, 16).map((entry) => ({
      word: entry.word.slice(0, 40),
      count: entry.count,
    })),
    overview: analysis
      ? {
          summary: humanise(analysis.overview.summary, pseudonyms.toDisplayName).slice(
            0,
            1500,
          ),
          confidence: analysis.overview.confidence,
        }
      : null,
    methodology: [
      statistics.initiation.algorithm,
      statistics.response.algorithm,
      `Statistics cover ${statistics.general.totalMessages} messages between ${formatDate(statistics.general.dateRange.start)} and ${formatDate(statistics.general.dateRange.end)}. Service messages such as calls and joins are excluded.`,
      statistics.meta.mediaMessages > 0
        ? `${statistics.meta.mediaMessages} messages contain photos, voice notes, videos or stickers. They are counted as messages, and their contents are not analysed.`
        : "This export contains no media messages.",
      statistics.meta.timezoneOffsetMinutes === null
        ? "This export carried no timezone information, so times are read exactly as written in the file."
        : `Times of day are shown in the export's own timezone (UTC${statistics.meta.timezoneOffsetMinutes >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(statistics.meta.timezoneOffsetMinutes) / 60)).padStart(2, "0")}:${String(Math.abs(statistics.meta.timezoneOffsetMinutes) % 60).padStart(2, "0")}).`,
      "The AI overview is interpretation of the conversation, not a psychological assessment of anyone in it.",
    ].filter(Boolean),
  };
}
