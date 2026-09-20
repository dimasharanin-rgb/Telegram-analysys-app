"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { formatPrice, getProduct } from "@/lib/billing/products";
import { api } from "@/lib/client/api";
import { toUserFacing } from "@/lib/client/use-remote";
import type { UserFacingError } from "@/lib/errors";

import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";

/**
 * Keeps a redirect target on this origin.
 *
 * The provider hands these back through the URL, so treat them as attacker
 * controlled: an absolute URL elsewhere would turn this page into an open
 * redirect for anyone who can get a link clicked.
 */
function samePathOrNull(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * The stand-in for a payment provider's hosted page.
 *
 * It says plainly that no money moves. Confirming posts to the server, which
 * signs a provider event and puts it through the same webhook path a real
 * provider's callback uses — this page never grants anything itself.
 */
export function ManualCheckout() {
  const router = useRouter();
  const params = useSearchParams();

  const reference = params.get("reference");
  const productId = params.get("product");
  const product = productId ? getProduct(productId) : null;

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<UserFacingError | null>(null);

  const confirm = async () => {
    if (!reference || !product) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmManualPayment(reference, product.id);
      router.push(samePathOrNull(params.get("next")) ?? "/account");
    } catch (thrown) {
      setError(toUserFacing(thrown, "That didn't go through."));
      setBusy(false);
    }
  };

  if (!reference || !product) {
    return (
      <Card>
        <CardBody className="sm:px-6 sm:py-6">
          <h1 className="text-xl font-semibold tracking-tight">
            This checkout link isn&rsquo;t valid
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Start again from the pricing page and the link will be rebuilt.
          </p>
          <Link href="/pricing" className="mt-5 inline-block">
            <Button>Back to pricing</Button>
          </Link>
        </CardBody>
      </Card>
    );
  }

  const cancelPath = samePathOrNull(params.get("cancel")) ?? "/pricing";

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="sm:px-6 sm:py-6">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
            Simulated checkout
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{product.name}</h1>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-brand-600">
            {formatPrice(product)}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted">{product.description}</p>

          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3">
            <p className="text-sm leading-relaxed text-ink">
              This installation has no payment provider configured. Nothing is charged
              and no card details are collected. Confirming below grants the credit so
              the rest of the flow can be used.
            </p>
          </div>

          {error ? (
            <div className="mt-4">
              <ErrorState error={error} />
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" onClick={() => void confirm()} disabled={busy}>
              {busy ? "Confirming…" : "Confirm without paying"}
            </Button>
            <Link href={cancelPath}>
              <Button size="lg" variant="secondary">
                Cancel
              </Button>
            </Link>
          </div>
        </CardBody>
      </Card>

      <p className="text-xs leading-relaxed text-faint">
        Reference {reference.slice(0, 16)}… — the credit is created by the server from a
        signed event, not by this page.
      </p>
    </div>
  );
}
