"use client";

import * as React from "react";
import type { ProgressEvent, PipelineStage } from "@/lib/pipeline/run";
import { cx } from "@/lib/client/format";
import { Button } from "./ui/Button";

export interface AnalysisProgressProps {
  event: ProgressEvent | null;
  onCancel?: () => void;
}

/**
 * Progress mirrors the actual pipeline. The percentage comes from completed
 * stages reported by the server, not from a timer - when a stage is slow, the
 * bar sits still and says which stage it is on.
 */
const STAGES: { id: PipelineStage; label: string }[] = [
  { id: "preparing", label: "Reading conversation" },
  { id: "reading", label: "Analyzing periods" },
  { id: "analyzing", label: "Finding patterns" },
  { id: "synthesizing", label: "Bringing findings together" },
  { id: "validating", label: "Checking the analysis" },
];

function stageIndex(stage: PipelineStage | undefined): number {
  if (!stage) return -1;
  if (stage === "done") return STAGES.length;
  const index = STAGES.findIndex((entry) => entry.id === stage);
  return index === -1 ? 0 : index;
}

export function AnalysisProgress({ event, onCancel }: AnalysisProgressProps) {
  const percent = event?.percent ?? 2;
  const current = stageIndex(event?.stage);

  // A single-pass run never emits "reading"; a chunked one never emits
  // "analyzing". Hide the step that this run is not going to use.
  const visible = STAGES.filter((stage) => {
    if (stage.id === "reading") return event?.stage !== "analyzing";
    if (stage.id === "analyzing") return event?.stage !== "reading";
    return true;
  });

  return (
    <div className="mx-auto max-w-lg py-8 text-center sm:py-16">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-brand-700">
        Analyzing
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight">
        {event?.message ?? "Getting ready…"}
      </h2>
      {event?.totalSteps && event.totalSteps > 1 ? (
        <p className="mt-2 text-sm text-muted">
          Step {event.step} of {event.totalSteps}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">
          Large conversations take longer — this can run for a minute or two.
        </p>
      )}

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label="Analysis progress"
        className="relative mt-8 h-1.5 w-full overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full rounded-full bg-brand-600 transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      </div>

      <ol className="mt-8 space-y-2.5 text-left">
        {visible.map((stage) => {
          const index = stageIndex(stage.id);
          const done = current > index;
          const active = current === index;
          return (
            <li key={stage.id} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cx(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[0.6rem]",
                  done && "border-brand-600 bg-brand-600 text-white",
                  active && "border-brand-600 bg-white text-brand-600",
                  !done && !active && "border-line bg-white text-faint",
                )}
              >
                {done ? "✓" : active ? "•" : ""}
              </span>
              <span
                className={cx(
                  "text-sm",
                  done && "text-muted",
                  active && "font-medium text-ink",
                  !done && !active && "text-faint",
                )}
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>

      {onCancel ? (
        <Button variant="ghost" size="sm" className="mt-8" onClick={onCancel}>
          Cancel analysis
        </Button>
      ) : null}
    </div>
  );
}

/** Lightweight progress used while the file is parsed locally. */
export function ImportProgressIndicator({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="relative mx-auto h-1.5 w-40 overflow-hidden rounded-full bg-line">
        <div className="animate-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-brand-600" />
      </div>
      <p className="mt-6 text-base font-medium text-ink" aria-live="polite">
        {message}
      </p>
      <p className="mt-1 text-sm text-muted">
        This happens on your device — nothing is uploaded yet.
      </p>
    </div>
  );
}
