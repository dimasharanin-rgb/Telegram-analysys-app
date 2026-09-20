/**
 * Provider selection and webhook application.
 *
 * `applyPaymentEvent` is the only path that creates an entitlement. It is
 * idempotent by provider event id, so a redelivered webhook - which every
 * provider does eventually - cannot grant a second entitlement.
 */

import { log } from "@/lib/logger";
import { getProduct } from "@/lib/billing/products";
import * as billing from "@/server/repositories/billing";
import { ensureOwner } from "@/server/repositories/owners";
import { ManualPaymentProvider } from "./manual";
import { StripePaymentProvider } from "./stripe";
import type { PaymentProvider, VerifiedPaymentEvent } from "./types";

export * from "./types";
export { MANUAL_SIGNATURE_HEADER } from "./manual";

let cached: PaymentProvider | null = null;

function manualSecret(): string {
  return (
    process.env.MANUAL_PAYMENT_SECRET?.trim() ||
    process.env.APP_SECRET?.trim() ||
    "manual-development-secret"
  );
}

export function paymentProvider(): PaymentProvider {
  if (cached) return cached;

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  const stripe = new StripePaymentProvider(secretKey, webhookSecret);

  cached = stripe.available ? stripe : new ManualPaymentProvider(manualSecret());
  return cached;
}

/** Test seam. */
export function resetPaymentProvider(): void {
  cached = null;
}

export interface AppliedPaymentEvent {
  applied: boolean;
  reason?: "duplicate" | "unknown_product";
  entitlementId?: string;
}

/**
 * Records the payment and, on success, grants exactly one entitlement.
 *
 * Two independent guards stop double-granting: the webhook ledger rejects a
 * repeated event id, and the entitlement lookup refuses to create a second
 * entitlement for a payment that already has one.
 */
export function applyPaymentEvent(
  provider: PaymentProvider,
  event: VerifiedPaymentEvent,
): AppliedPaymentEvent {
  if (!billing.claimWebhookEvent(provider.id, event.eventId, event.type)) {
    log.info("payments.webhook_duplicate", {
      provider: provider.id,
      eventType: event.type,
    });
    return { applied: false, reason: "duplicate" };
  }

  const product = getProduct(event.productId);
  if (!product) {
    log.warn("payments.unknown_product", { provider: provider.id });
    return { applied: false, reason: "unknown_product" };
  }

  ensureOwner(event.ownerId);

  const payment = billing.upsertPayment({
    ownerId: event.ownerId,
    provider: provider.id,
    providerRef: event.reference,
    productId: event.productId,
    amountMinor: event.amountMinor,
    currency: event.currency,
    status: event.status,
  });

  if (event.status !== "PAID") {
    log.info("payments.not_granted", {
      provider: provider.id,
      status: event.status,
    });
    return { applied: true };
  }

  const existing = billing.findEntitlementByPayment(payment.id);
  if (existing) {
    log.info("payments.entitlement_exists", { entitlementId: existing.id });
    return { applied: true, entitlementId: existing.id };
  }

  const entitlement = billing.createEntitlement({
    ownerId: event.ownerId,
    productId: product.id,
    source: "purchase",
    paymentId: payment.id,
    creditsTotal: product.credits,
  });

  log.info("payments.entitlement_granted", {
    entitlementId: entitlement.id,
    productId: product.id,
    credits: product.credits,
  });

  return { applied: true, entitlementId: entitlement.id };
}
