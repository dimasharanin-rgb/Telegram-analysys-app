"use client";

import * as React from "react";
import { Button } from "./ui/Button";

/** The capability never changes for the life of the page. */
const subscribeNever = () => () => {};

export interface ShareButtonProps {
  /** Short text summary of the stats - safe to paste anywhere. */
  summary: string;
  /** The generated PDF, once the user has exported one. */
  file?: File | null;
}

/**
 * Share, without building a share *link*.
 *
 * There is deliberately no public URL: a link containing a private
 * conversation would need authentication, expiry and access control to be
 * responsible, and none of that belongs in this MVP. What is offered instead
 * is the file the user already has, or a text summary they can paste.
 */
export function ShareButton({ summary, file }: ShareButtonProps) {
  const [status, setStatus] = React.useState<"idle" | "copied" | "failed">("idle");

  // Browser-only capability. useSyncExternalStore gives the server a stable
  // `false` snapshot, so the button appears after hydration without a
  // mismatch and without a setState-in-effect.
  const canShare = React.useSyncExternalStore(
    subscribeNever,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );

  const share = async () => {
    try {
      const canShareFile =
        file &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] });

      await navigator.share(
        canShareFile
          ? { title: "Conversation analysis", text: summary, files: [file] }
          : { title: "Conversation analysis", text: summary },
      );
      setStatus("idle");
    } catch (error) {
      // A user dismissing the sheet is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copy();
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 2400);
    } catch {
      setStatus("failed");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {canShare ? (
        <Button variant="secondary" onClick={share}>
          Share
        </Button>
      ) : null}
      <Button variant="secondary" onClick={copy}>
        {status === "copied" ? "Copied ✓" : "Copy summary"}
      </Button>
      {status === "failed" ? (
        <span role="status" className="text-xs text-caution">
          Couldn&rsquo;t copy — select the summary manually.
        </span>
      ) : null}
    </div>
  );
}
