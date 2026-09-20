import * as React from "react";
import { seriesColor } from "@/lib/palette";
import { cx } from "@/lib/client/format";

export interface ParticipantBadgeProps {
  name: string;
  index: number;
  detail?: string;
  size?: "sm" | "md";
  className?: string;
}

/** Name + colour dot. The colour is never the only cue - the name is right there. */
export function ParticipantBadge({
  name,
  index,
  detail,
  size = "md",
  className,
}: ParticipantBadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border border-line bg-white",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx("shrink-0 rounded-full", size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5")}
        style={{ backgroundColor: seriesColor(index) }}
      />
      <span className="font-medium text-ink">{name}</span>
      {detail ? <span className="text-muted">{detail}</span> : null}
    </span>
  );
}
