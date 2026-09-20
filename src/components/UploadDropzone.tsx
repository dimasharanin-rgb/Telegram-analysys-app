"use client";

import * as React from "react";
import { publicLimits } from "@/lib/config";
import { cx, formatBytes } from "@/lib/client/format";

export interface UploadDropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function UploadDropzone({ onFile, disabled }: UploadDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const pick = React.useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div>
      {/* The whole area is a button so keyboard users get one obvious target. */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="Choose a Telegram JSON export to analyse"
        onClick={pick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            pick();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cx(
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors duration-150 sm:py-16",
          disabled
            ? "cursor-not-allowed border-line bg-canvas-soft"
            : "cursor-pointer border-brand-200 bg-brand-50/50 hover:border-brand-400 hover:bg-brand-50",
          dragging && "border-brand-500 bg-brand-100/70",
        )}
      >
        <span
          aria-hidden="true"
          className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-white text-brand-600 ring-1 ring-brand-100"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4" />
            <path d="m7 9 5-5 5 5" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
        </span>
        <p className="text-base font-medium text-ink">
          Drop your Telegram export here
        </p>
        <p className="mt-1 text-sm text-muted">
          or <span className="font-medium text-brand-700">browse for result.json</span>
        </p>
        <p className="mt-4 text-xs text-faint">
          JSON only · up to {formatBytes(publicLimits.maxUploadBytes)}
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the same file twice still fires a change event.
          event.target.value = "";
          if (file) onFile(file);
        }}
      />

      <details className="mt-6 rounded-lg border border-line bg-canvas-soft px-4 py-3">
        <summary className="cursor-pointer list-none text-sm font-medium text-ink-soft">
          How do I export a Telegram chat?
          <span aria-hidden="true" className="float-right text-muted">
            ⌄
          </span>
        </summary>
        <ol className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
          <li>1. Open Telegram Desktop on a computer (the mobile apps cannot export).</li>
          <li>2. Open the chat, then the ⋮ menu → <strong>Export chat history</strong>.</li>
          <li>
            3. Set <strong>Format</strong> to <strong>Machine-readable JSON</strong>. You
            can uncheck photos, videos and voice messages — this MVP only reads text.
          </li>
          <li>4. Export, then upload the <code>result.json</code> file it creates.</li>
        </ol>
      </details>
    </div>
  );
}
