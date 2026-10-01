import type { ReactNode } from "react";

type Tone = "info" | "warn" | "block";

const TONES: Record<Tone, string> = {
  info: "border-line-strong bg-panel-2 text-muted",
  warn: "border-warn/40 bg-warn/8 text-warn",
  block: "border-block/40 bg-block/8 text-block",
};

export function Notice({ tone = "info", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <div className={`rounded border px-3 py-2 text-[12px] ${TONES[tone]} ${className}`}>{children}</div>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-hidden />
      {label}
    </span>
  );
}
