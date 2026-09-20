import type { Metadata } from "next";
import { Suspense } from "react";

import { ManualCheckout } from "@/components/v2/ManualCheckout";
import { SiteHeader } from "@/components/v2/SiteHeader";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutConfirmPage() {
  return (
    <div className="flex min-h-dvh flex-col pb-20 sm:pb-0">
      <SiteHeader />
      <main id="main" className="app-container flex-1 py-6 sm:py-10">
        <div className="mx-auto max-w-lg">
          <Suspense fallback={<p className="py-16 text-center text-muted">Loading…</p>}>
            <ManualCheckout />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
