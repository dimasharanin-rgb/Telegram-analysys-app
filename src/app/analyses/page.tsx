import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { HistoryView } from "@/components/v2/HistoryView";
import { SiteHeader } from "@/components/v2/SiteHeader";

export const metadata: Metadata = { title: "Analyses" };

export default function AnalysesPage() {
  return (
    <div className="flex min-h-dvh flex-col pb-20 sm:pb-0">
      <SiteHeader />
      <main id="main" className="app-container flex-1 py-6 sm:py-10">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Your analyses</h1>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                Everything you have started in this browser. Reopen a finished report,
                pick up one that is still waiting, or delete it for good.
              </p>
            </div>
            <Link href="/analyze">
              <Button>New analysis</Button>
            </Link>
          </div>

          <HistoryView />

          <p className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-faint">
            These analyses are linked to a cookie in this browser, not to an account.
            Clearing your cookies loses access to them, and deleting one here removes
            the stored statistics, report and excerpts.
          </p>
        </div>
      </main>
    </div>
  );
}
