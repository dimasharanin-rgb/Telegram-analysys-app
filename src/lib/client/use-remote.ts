"use client";

/**
 * Load something from the API when a screen mounts.
 *
 * Three screens need the same four things — what came back, what went wrong,
 * a way to fetch again after a mutation, and a way to report a failure that
 * happened outside the fetch. Doing it once keeps every screen rendering the
 * same `UserFacingError` shape and keeps the late-response guard in one place.
 */

import * as React from "react";

import type { UserFacingError } from "@/lib/errors";
import { ApiError } from "./api";

/** Maps anything thrown to something safe to put on screen. */
export function toUserFacing(thrown: unknown, message: string): UserFacingError {
  return thrown instanceof ApiError
    ? thrown.userFacing
    : { code: "UNKNOWN", message, retryable: true };
}

export interface Remote<T> {
  /** null until the first successful load. */
  data: T | null;
  error: UserFacingError | null;
  /** Fetch again — for a retry button, a poll, or after a mutation. */
  reload: () => void;
  /** Replace what is held, when the caller already has the newer value. */
  set: React.Dispatch<React.SetStateAction<T | null>>;
  /** Show a failure that did not come from the fetch. */
  fail: (error: UserFacingError) => void;
}

/**
 * `fetcher` must be stable — wrap it in `useCallback` — because a new identity
 * means "fetch again".
 */
export function useRemote<T>(
  fetcher: () => Promise<T>,
  failureMessage: string,
): Remote<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<UserFacingError | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    fetcher().then(
      (next) => {
        if (!active) return;
        setData(next);
        setError(null);
      },
      (thrown: unknown) => {
        // A reply that arrives after the screen moved on is not an error the
        // user should see.
        if (active) setError(toUserFacing(thrown, failureMessage));
      },
    );
    return () => {
      active = false;
    };
  }, [fetcher, failureMessage, attempt]);

  const reload = React.useCallback(() => setAttempt((value) => value + 1), []);
  const fail = React.useCallback((next: UserFacingError) => setError(next), []);

  return { data, error, reload, set: setData, fail };
}
