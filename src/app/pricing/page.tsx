import type { Metadata } from "next";
import Link from "next/link";

import { PricingPlans } from "@/components/v2/PricingPlans";
import { SiteHeader } from "@/components/v2/SiteHeader";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <div className="flex min-h-dvh flex-col pb-20 sm:pb-0">
      <SiteHeader />
      <main id="main" className="app-container flex-1 py-6 sm:py-10">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-semibold tracking-tight">What an analysis costs</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Every plan computes the full statistics on your device. What you pay for is
            the depth of the written analysis — how many sections of your conversation
            get read, and how closely.
          </p>

          <div className="mt-8">
            <PricingPlans />
          </div>

          <div className="mt-10 border-t border-line pt-6">
            <h2 className="text-base font-semibold tracking-tight">Before you buy</h2>
            <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted">
              <li>
                Credits are held against this browser, not an account. Clearing your
                cookies loses access to them.
              </li>
              <li>
                A credit is spent when an analysis starts running. If the analysis
                fails, the credit is returned.
              </li>
              <li>
                Consent from the other participants is required before an analysis can
                run, whichever plan you choose — see{" "}
                <Link
                  href="/privacy"
                  className="font-medium text-brand-700 underline underline-offset-4"
                >
                  the privacy notice
                </Link>
                .
              </li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
