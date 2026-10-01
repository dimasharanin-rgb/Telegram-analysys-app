import { useClock } from "./useClock";

/** "Data: 2 seconds ago" — ticking every second — plus whether it is past the freshness threshold. */
export function useDataAge(timestamp: number | null | undefined, thresholdSeconds: number) {
  const now = useClock(1000);
  if (!timestamp) return { text: "Data: —", seconds: null, stale: false };
  const seconds = Math.max(0, Math.round((now.getTime() - timestamp) / 1000));
  const text =
    seconds < 120 ? `Data: ${seconds} second${seconds === 1 ? "" : "s"} ago` : seconds < 7200 ? `Data: ${Math.round(seconds / 60)} min ago` : `Data: ${(seconds / 3600).toFixed(1)} h ago`;
  return { text, seconds, stale: seconds > thresholdSeconds };
}
