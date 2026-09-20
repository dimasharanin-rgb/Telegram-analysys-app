import type { Metadata } from "next";

import { AccountView } from "@/components/v2/AccountView";
import { SiteHeader } from "@/components/v2/SiteHeader";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <div className="flex min-h-dvh flex-col pb-20 sm:pb-0">
      <SiteHeader />
      <main id="main" className="app-container flex-1 py-6 sm:py-10">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
          <p className="mb-6 mt-1.5 text-sm leading-relaxed text-muted">
            What this browser holds and what is stored for it.
          </p>
          <AccountView />
        </div>
      </main>
    </div>
  );
}
