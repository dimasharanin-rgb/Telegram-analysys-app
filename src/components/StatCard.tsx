import * as React from "react";
import { cx } from "@/lib/client/format";

export interface StatCardProps {
  label: string;
  value: string;
  detail?: string;
  emphasis?: boolean;
  className?: string;
}

/** One number, one label. The Stats tab is built out of these. */
export function StatCard({ label, value, detail, emphasis, className }: StatCardProps) {
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-4 print-block",
        emphasis ? "border-brand-100 bg-brand-50" : "border-line bg-white",
        className,
      )}
    >
      <p className="text-[0.7rem] font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p
        className={cx(
          "mt-1 text-2xl font-semibold tracking-tight tabular-nums",
          emphasis ? "text-brand-700" : "text-ink",
        )}
      >
        {value}
      </p>
      {detail ? <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p> : null}
    </div>
  );
}
