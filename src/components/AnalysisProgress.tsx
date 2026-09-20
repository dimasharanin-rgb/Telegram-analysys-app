"use client";

/**
 * Local import progress.
 *
 * The AI run has its own progress panel on the analysis page, driven by the
 * job's server-reported stages. This one covers the part that happens before
 * any of that: reading and measuring the export in the browser.
 */

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
