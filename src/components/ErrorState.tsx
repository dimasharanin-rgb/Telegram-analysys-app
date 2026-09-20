"use client";

import * as React from "react";
import type { UserFacingError } from "@/lib/errors";
import { Button } from "./ui/Button";

export interface ErrorStateProps {
  error: UserFacingError;
  onRetry?: () => void;
  onStartOver?: () => void;
  retryLabel?: string;
}

/**
 * The only place errors are rendered. It shows the mapped message and hint -
 * never a stack trace, a provider payload or anything that could carry a key.
 */
export function ErrorState({ error, onRetry, onStartOver, retryLabel }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-5 sm:px-6"
    >
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-caution"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 8v5" />
            <path d="M12 17h.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{error.message}</p>
          {error.hint ? (
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{error.hint}</p>
          ) : null}
          {(onRetry && error.retryable) || onStartOver ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {onRetry && error.retryable ? (
                <Button size="sm" onClick={onRetry}>
                  {retryLabel ?? "Try again"}
                </Button>
              ) : null}
              {onStartOver ? (
                <Button size="sm" variant="secondary" onClick={onStartOver}>
                  Start over
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
