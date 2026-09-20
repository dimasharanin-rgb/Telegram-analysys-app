import * as React from "react";
import { cx } from "@/lib/client/format";

type Tone = "neutral" | "brand" | "positive" | "caution";

const TONES: Record<Tone, string> = {
  neutral: "bg-canvas-soft text-muted border-line",
  brand: "bg-brand-50 text-brand-700 border-brand-100",
  positive: "bg-emerald-50 text-positive border-emerald-100",
  caution: "bg-amber-50 text-caution border-amber-100",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

const CONFIDENCE_LABEL = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
} as const;

export function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  return (
    <Badge tone={level === "high" ? "brand" : level === "medium" ? "neutral" : "caution"}>
      <span aria-hidden="true" className="text-[0.6rem]">
        {level === "high" ? "●●●" : level === "medium" ? "●●○" : "●○○"}
      </span>
      {CONFIDENCE_LABEL[level]}
    </Badge>
  );
}
