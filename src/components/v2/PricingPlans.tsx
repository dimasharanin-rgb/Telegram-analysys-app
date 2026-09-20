"use client";

import * as React from "react";
import Link from "next/link";

import { MODULE_DEFINITIONS } from "@/lib/analysis/modules";
import { PRODUCTS, formatPrice, isFree } from "@/lib/billing/products";
import { api } from "@/lib/client/api";
import { cx, formatNumber } from "@/lib/client/format";
import { toUserFacing } from "@/lib/client/use-remote";
import type { UserFacingError } from "@/lib/errors";

import { ErrorState } from "@/components/ErrorState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";

/**
 * The catalogue, rendered from the same objects the server enforces.
 *
 * Buying here only starts a checkout. Nothing on this page unlocks anything:
 * the credit appears once the provider's signed event reaches the webhook.
 */
export function PricingPlans({ returnPath = "/account" }: { returnPath?: string }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<UserFacingError | null>(null);

  const buy = React.useCallback(
    async (productId: string) => {
      setBusy(productId);
      setError(null);
      try {
        const session = await api.checkout(productId, returnPath);
        window.location.assign(session.url);
      } catch (thrown) {
        setError(toUserFacing(thrown, "Couldn't start checkout."));
        setBusy(null);
      }
    },
    [returnPath],
  );

  return (
    <div className="space-y-5">
      {error ? <ErrorState error={error} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {PRODUCTS.map((product) => (
          <Card
            key={product.id}
            className={cx("flex flex-col", !product.available && "opacity-80")}
          >
            <CardBody className="flex flex-1 flex-col sm:px-6 sm:py-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{product.name}</h2>
                {product.available ? (
                  product.credits > 1 ? (
                    <Badge tone="brand">{product.credits} analyses</Badge>
                  ) : null
                ) : (
                  <Badge tone="neutral">Not available yet</Badge>
                )}
              </div>

              <p className="mt-1 text-2xl font-semibold tracking-tight text-brand-600">
                {formatPrice(product)}
              </p>

              <p className="mt-3 text-sm leading-relaxed text-muted">
                {product.description}
              </p>

              <ul className="mt-4 space-y-1.5 text-sm leading-relaxed text-ink-soft">
                <li>Up to {formatNumber(product.maxMessages)} messages</li>
                <li>
                  {product.allowedModules.length === 1
                    ? MODULE_DEFINITIONS[product.allowedModules[0]!].name
                    : `${product.allowedModules.length} analysis sections`}
                </li>
                <li>
                  {product.contentTypes.length === 1
                    ? "Text messages"
                    : "Text, photos, voice notes and video"}
                </li>
              </ul>

              {product.unavailableReason ? (
                <p className="mt-4 rounded-lg border border-line bg-canvas-soft px-4 py-3 text-xs leading-relaxed text-muted">
                  {product.unavailableReason}
                </p>
              ) : null}

              <div className="mt-auto pt-6">
                {!product.available ? (
                  <Button variant="secondary" disabled fullWidth>
                    Not available yet
                  </Button>
                ) : isFree(product) ? (
                  <Link href="/analyze" className="block">
                    <Button variant="secondary" fullWidth>
                      Start free
                    </Button>
                  </Link>
                ) : (
                  <Button
                    fullWidth
                    onClick={() => void buy(product.id)}
                    disabled={busy !== null}
                  >
                    {busy === product.id ? "Opening checkout…" : `Buy — ${formatPrice(product)}`}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
