import type { FinalVerdict } from "@/types/analysis";

export const VERDICT_COLOR: Record<FinalVerdict, string> = {
  ACCEPTABLE: "text-pass",
  CAUTION: "text-warn",
  REJECT: "text-block",
  BLOCKED: "text-block",
  UNAVAILABLE: "text-muted",
};

const BADGE: Record<FinalVerdict, string> = {
  ACCEPTABLE: "bg-pass/12 text-pass border-pass/30",
  CAUTION: "bg-warn/12 text-warn border-warn/30",
  REJECT: "bg-block/12 text-block border-block/30",
  BLOCKED: "bg-block/20 text-block border-block/50",
  UNAVAILABLE: "bg-line text-muted border-line-strong",
};

export function VerdictBadge({ verdict }: { verdict: FinalVerdict }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-px text-[10.5px] font-semibold tracking-wide ${BADGE[verdict]}`}>
      {verdict}
    </span>
  );
}

export function DirectionTag({ direction }: { direction: "LONG" | "SHORT" }) {
  return <span className={`font-semibold ${direction === "LONG" ? "text-long" : "text-short"}`}>{direction}</span>;
}
