"use client";

import * as React from "react";
import Link from "next/link";

import { api } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import { useRemote } from "@/lib/client/use-remote";

import { ErrorState } from "@/components/ErrorState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, SectionTitle } from "@/components/ui/Card";

function money(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(
      amountMinor / 100,
    );
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * What this browser holds: credits, purchases, and what is stored server-side.
 *
 * There is no profile here because there is no account — the identity is a
 * signed cookie, and the page says so rather than implying otherwise.
 */
export function AccountView() {
  const fetcher = React.useCallback(() => api.account(), []);
  const { data: account, error, reload } = useRemote(fetcher, "Couldn't load your account.");

  if (error && !account) return <ErrorState error={error} onRetry={reload} />;
  if (!account) return <p className="py-16 text-center text-muted">Loading…</p>;

  const usable = account.entitlements.filter(
    (entitlement) => entitlement.creditsRemaining > 0 && entitlement.status === "ACTIVE",
  );
  const freeUsed = account.entitlements
    .filter((entitlement) => entitlement.source === "free")
    .reduce((sum, entitlement) => sum + entitlement.creditsTotal, 0);

  return (
    <div className="space-y-6">
      {error ? <ErrorState error={error} onRetry={reload} /> : null}

      <Card>
        <CardBody className="sm:px-6 sm:py-6">
          <SectionTitle hint={`${account.freeAnalysesAllowed} free per browser`}>
            Analyses available
          </SectionTitle>

          {usable.length === 0 ? (
            <p className="text-sm leading-relaxed text-muted">
              No credits held. Free analyses are granted as you use them —{" "}
              {Math.max(0, account.freeAnalysesAllowed - freeUsed)} of{" "}
              {account.freeAnalysesAllowed} left in this browser.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {usable.map((entitlement, index) => (
                <li
                  key={`${entitlement.productId}-${entitlement.createdAt}-${index}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="text-sm font-medium text-ink">
                    {entitlement.productName}
                  </span>
                  <span className="text-sm text-muted">
                    {entitlement.creditsRemaining} of {entitlement.creditsTotal} left
                    {entitlement.source === "free" ? " · free" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/analyze">
              <Button>New analysis</Button>
            </Link>
            <Link href="/pricing">
              <Button variant="secondary">Buy credits</Button>
            </Link>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="sm:px-6 sm:py-6">
          <SectionTitle>Purchases</SectionTitle>
          {account.payments.length === 0 ? (
            <p className="text-sm leading-relaxed text-muted">Nothing purchased yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {account.payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {account.products.find((entry) => entry.id === payment.productId)
                        ?.name ?? payment.productId}
                    </p>
                    <p className="text-xs text-faint">
                      {formatDateTime(payment.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-ink-soft">
                      {money(payment.amountMinor, payment.currency)}
                    </span>
                    <Badge tone={payment.status === "PAID" ? "positive" : "neutral"}>
                      {payment.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {account.payments_provider.simulated ? (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm leading-relaxed text-ink">
              This installation is running without a payment provider. Checkout is
              simulated: no card is taken and no money moves. Credits are still granted
              the same way a real purchase would grant them — through a signed,
              server-verified event.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="sm:px-6 sm:py-6">
          <SectionTitle>Your data</SectionTitle>
          <ul className="space-y-2.5 text-sm leading-relaxed text-muted">
            <li>
              You are identified by a signed cookie in this browser, not by an account.
              Nothing here is linked to an email address or a phone number.
            </li>
            <li>
              The server stores the statistics, the written report, and the exchanges
              the report quotes. The rest of your export never leaves your device, and
              the unquoted excerpts are deleted once an analysis finishes.
            </li>
            <li>
              Deleting an analysis from{" "}
              <Link
                href="/analyses"
                className="font-medium text-brand-700 underline underline-offset-4"
              >
                your analyses
              </Link>{" "}
              removes its stored statistics, report and excerpts.
            </li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
