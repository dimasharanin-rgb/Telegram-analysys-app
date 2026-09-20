/** Presentation helpers shared by the UI and the PDF payload builder. */

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

/** Human duration: "42 sec", "7 min", "2.4 hr", "3 days". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) {
    const hours = seconds / 3600;
    return hours < 10 ? `${hours.toFixed(1)} hr` : `${Math.round(hours)} hr`;
  }
  const days = seconds / 86_400;
  return days < 10 ? `${days.toFixed(1)} days` : `${Math.round(days)} days`;
}

/** `2024-03-08` → `8 Mar 2024`. Parsed as UTC so the label never shifts. */
export function formatDate(isoDate: string): string {
  const ms = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ms)) return isoDate;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

/** `2024-03` → `Mar 2024`. */
export function formatMonth(month: string): string {
  const ms = Date.parse(`${month}-01T00:00:00Z`);
  if (!Number.isFinite(ms)) return month;
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

/** `2024-03-08T19:04:11` → `8 Mar 2024, 19:04`. */
export function formatDateTime(localIso: string): string {
  const date = formatDate(localIso.slice(0, 10));
  const time = localIso.slice(11, 16);
  return time ? `${date}, ${time}` : date;
}

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Joins class names, dropping falsy values. */
export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}
