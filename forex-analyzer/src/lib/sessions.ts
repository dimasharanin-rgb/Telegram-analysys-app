import type { TradingSession } from "@/types/settings";

/** Session windows in UTC hours [start, end). Approximate; they shift with daylight saving. */
export const SESSION_WINDOWS_UTC: Record<TradingSession, { start: number; end: number; label: string }> = {
  SYDNEY: { start: 21, end: 6, label: "Sydney" },
  TOKYO: { start: 0, end: 9, label: "Tokyo" },
  LONDON: { start: 7, end: 16, label: "London" },
  NEW_YORK: { start: 12, end: 21, label: "New York" },
};

function inWindow(hour: number, start: number, end: number): boolean {
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function activeSessions(at: Date): TradingSession[] {
  const hour = at.getUTCHours() + at.getUTCMinutes() / 60;
  return (Object.keys(SESSION_WINDOWS_UTC) as TradingSession[]).filter((s) => {
    const w = SESSION_WINDOWS_UTC[s];
    return inWindow(hour, w.start, w.end);
  });
}
