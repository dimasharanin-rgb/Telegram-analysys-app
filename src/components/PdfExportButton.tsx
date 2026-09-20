"use client";

import * as React from "react";
import type { PdfReportPayload } from "@/lib/pdf/payload";
import { Button } from "./ui/Button";

export interface PdfExportButtonProps {
  buildPayload: () => PdfReportPayload;
  /** Called with the generated file so Share can offer it too. */
  onGenerated?: (file: File) => void;
}

type State = "idle" | "working" | "failed";

/**
 * Downloads the server-rendered report.
 *
 * If generation fails the button does not simply give up: it offers the
 * browser's own print dialog, which produces a usable PDF from the Stats page.
 */
export function PdfExportButton({ buildPayload, onGenerated }: PdfExportButtonProps) {
  const [state, setState] = React.useState<State>("idle");

  const download = async () => {
    setState("working");
    try {
      const response = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!response.ok) throw new Error("export failed");

      const blob = await response.blob();
      const payload = buildPayload();
      const filename = `conversation-analysis-${payload.dateRange.start}.pdf`;
      const file = new File([blob], filename, { type: "application/pdf" });
      onGenerated?.(file);

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      // Give the browser a moment to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="no-print">
      <Button onClick={download} disabled={state === "working"}>
        {state === "working" ? "Preparing PDF…" : "Export PDF"}
      </Button>

      {state === "failed" ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm"
        >
          <p className="text-ink">The PDF couldn&rsquo;t be generated.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={download}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.print()}>
              Print this page instead
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
