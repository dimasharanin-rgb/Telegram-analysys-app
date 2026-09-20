"use client";

import * as React from "react";

import type { ConsentStatus } from "@/lib/consent/state";
import type { UserFacingError } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ErrorState";

export interface ConsentDecisionProps {
  token: string;
  status: ConsentStatus;
  participantName: string;
}

async function post(path: string, body: unknown): Promise<UserFacingError | null> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | { error?: UserFacingError }
    | null;
  return (
    payload?.error ?? {
      code: "UNKNOWN",
      message: "That didn't go through.",
      retryable: true,
    }
  );
}

/**
 * The decision controls.
 *
 * Both buttons are the same size and weight. Declining is a normal outcome of
 * being asked, and the interface does not make it feel like a mistake.
 */
export function ConsentDecision({ token, status, participantName }: ConsentDecisionProps) {
  const [current, setCurrent] = React.useState<ConsentStatus>(status);
  const [busy, setBusy] = React.useState<"accept" | "decline" | "withdraw" | null>(null);
  const [error, setError] = React.useState<UserFacingError | null>(null);

  const decide = async (decision: "ACCEPTED" | "DECLINED") => {
    setBusy(decision === "ACCEPTED" ? "accept" : "decline");
    setError(null);
    const failure = await post("/api/consent/decide", { token, decision });
    setBusy(null);
    if (failure) setError(failure);
    else setCurrent(decision);
  };

  const withdraw = async () => {
    setBusy("withdraw");
    setError(null);
    const failure = await post("/api/consent/withdraw", { token });
    setBusy(null);
    if (failure) setError(failure);
    else setCurrent("WITHDRAWN");
  };

  if (current === "ACCEPTED") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-5 py-4">
          <p className="font-medium text-ink">You agreed to this analysis.</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            You can change your mind at any time, with no deadline and no reason
            needed. Keep this link if you might want to.
          </p>
        </div>
        {error ? <ErrorState error={error} /> : null}
        <Button variant="secondary" onClick={() => void withdraw()} disabled={busy !== null}>
          {busy === "withdraw" ? "Withdrawing…" : "Withdraw my consent"}
        </Button>
      </div>
    );
  }

  if (current === "DECLINED") {
    return (
      <div className="rounded-xl border border-line bg-canvas-soft px-5 py-4">
        <p className="font-medium text-ink">You did not agree.</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          The analysis will not run, and this conversation has not been sent for AI
          processing. Nothing further is needed from you.
        </p>
      </div>
    );
  }

  if (current === "WITHDRAWN") {
    return (
      <div className="rounded-xl border border-line bg-canvas-soft px-5 py-4">
        <p className="font-medium text-ink">You withdrew your consent.</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          No further analysis of this conversation will start.
        </p>
      </div>
    );
  }

  if (current === "EXPIRED") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4">
        <p className="font-medium text-ink">This request has expired.</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          It can no longer be answered. If it is still relevant,{" "}
          {participantName === "you" ? "the requester" : "the person who sent it"} can
          send a new one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <ErrorState error={error} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          size="lg"
          onClick={() => void decide("ACCEPTED")}
          disabled={busy !== null}
          className="sm:min-w-44"
        >
          {busy === "accept" ? "Saving…" : "I agree"}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          onClick={() => void decide("DECLINED")}
          disabled={busy !== null}
          className="sm:min-w-44"
        >
          {busy === "decline" ? "Saving…" : "I do not agree"}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-faint">
        Your decision is recorded with the time and the version of this document. You
        can change it later using this same link.
      </p>
    </div>
  );
}
