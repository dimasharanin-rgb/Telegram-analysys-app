/**
 * GET /api/account — what this browser's identity currently holds.
 */

import { availableProducts, formatPrice } from "@/lib/billing/products";
import { freeLimit, summarise } from "@/server/billing/entitlements";
import { json, withOwner } from "@/server/http";
import { listPayments } from "@/server/repositories/billing";
import { paymentProvider } from "@/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withOwner(async ({ ownerId }) => {
  const provider = paymentProvider();
  return json({
    entitlements: summarise(ownerId),
    freeAnalysesAllowed: freeLimit(),
    payments: listPayments(ownerId).map((payment) => ({
      id: payment.id,
      productId: payment.productId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      status: payment.status,
      createdAt: payment.createdAt,
    })),
    products: availableProducts().map((product) => ({
      id: product.id,
      name: product.name,
      priceLabel: formatPrice(product),
    })),
    payments_provider: { id: provider.id, simulated: provider.simulated },
  });
});
