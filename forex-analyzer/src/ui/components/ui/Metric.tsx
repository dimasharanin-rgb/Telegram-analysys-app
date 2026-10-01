import type { ReactNode } from "react";

interface MetricProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "pass" | "warn" | "block";
  /** 0..1, draws a thin usage bar under the value. */
  bar?: number | null;
}

const TONE: Record<NonNullable<MetricProps["tone"]>, string> = {
  default: "text-fg",
  pass: "text-pass",
  warn: "text-warn",
  block: "text-block",
};

export function Metric({ label, value, sub, tone = "default", bar }: MetricProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-line bg-panel px-3 py-2.5">
      <span className="label truncate">{label}</span>
      <span className={`num text-[18px] font-semibold leading-tight ${TONE[tone]}`}>{value}</span>
      {bar !== undefined && bar !== null && (
        <div className="h-1 w-full overflow-hidden rounded bg-line" aria-hidden>
          <div
            className={`h-full ${bar > 0.66 ? "bg-pass" : bar > 0.33 ? "bg-warn" : "bg-block"}`}
            style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }}
          />
        </div>
      )}
      {sub && <span className="truncate text-[11px] text-faint">{sub}</span>}
    </div>
  );
}

/** Compact label/value row for dense panels. */
export function KV({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted">{label}</span>
      <span className={`num text-right ${tone ?? "text-fg"}`}>{value}</span>
    </div>
  );
}
