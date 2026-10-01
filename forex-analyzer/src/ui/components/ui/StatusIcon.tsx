import type { CheckStatus } from "@/shared/types/risk";

const STYLES: Record<CheckStatus, { glyph: string; className: string; label: string }> = {
  PASS: { glyph: "✓", className: "text-pass", label: "Pass" },
  WARNING: { glyph: "!", className: "text-warn", label: "Warning" },
  BLOCK: { glyph: "✕", className: "text-block", label: "Blocked" },
};

export function StatusIcon({ status }: { status: CheckStatus }) {
  const s = STYLES[status];
  return (
    <span
      aria-label={s.label}
      title={s.label}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[11px] font-bold ${s.className} ${
        status === "PASS" ? "bg-pass/10" : status === "WARNING" ? "bg-warn/15" : "bg-block/15"
      }`}
    >
      {s.glyph}
    </span>
  );
}
