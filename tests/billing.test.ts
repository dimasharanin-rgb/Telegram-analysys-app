import { beforeEach, describe, expect, it } from "vitest";

import { formatPrice, getProduct } from "@/lib/billing/products";
import { AppError } from "@/lib/errors";
import {
  checkEntitlement,
  freeLimit,
  releaseEntitlement,
  reserveEntitlement,
  summarise,
} from "@/server/billing/entitlements";
import { applyPaymentEvent, resetPaymentProvider } from "@/server/payments";
import { ManualPaymentProvider, MANUAL_SIGNATURE_HEADER } from "@/server/payments/manual";
import { StripePaymentProvider, toVerifiedEvent } from "@/server/payments/stripe";
import type { VerifiedPaymentEvent } from "@/server/payments/types";
import { listEntitlements, listPayments } from "@/server/repositories/billing";
import { ensureOwner } from "@/server/repositories/owners";
import { withTestDatabase } from "./support/db";
import crypto from "node:crypto";

withTestDatabase();

beforeEach(() => {
  resetPaymentProvider();
  delete process.env.FREE_ANALYSES_PER_OWNER;
  ensureOwner("owner-1");
});

function paidEvent(overrides: Partial<VerifiedPaymentEvent> = {}): VerifiedPaymentEvent {
  return {
    eventId: "evt_1",
    type: "checkout.session.completed",
    reference: "cs_1",
    ownerId: "owner-1",
    productId: "deep-text",
    amountMinor: 900,
    currency: "EUR",
    status: "PAID",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * Entitlements
 * ---------------------------------------------------------------------- */

describe("entitlements", () => {
  it("grants a free analysis on demand, up to the configured ceiling", () => {
    process.env.FREE_ANALYSES_PER_OWNER = "2";

    expect(checkEntitlement("owner-1", "free").ok).toBe(true);
    reserveEntitlement("owner-1", "free");
    reserveEntitlement("owner-1", "free");

    const check = checkEntitlement("owner-1", "free");
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("free_limit_reached");
    expect(() => reserveEntitlement("owner-1", "free")).toThrowError(AppError);
  });

  it("refuses a paid product with no purchase", () => {
    const check = checkEntitlement("owner-1", "deep-text");
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("requires_purchase");
    expect(() => reserveEntitlement("owner-1", "deep-text")).toThrowError(AppError);
  });

  it("refuses a product this build cannot deliver", () => {
    expect(checkEntitlement("owner-1", "multimodal").reason).toBe("unavailable");
    expect(() => reserveEntitlement("owner-1", "multimodal")).toThrowError(AppError);
  });

  it("spends credits one at a time and then stops", () => {
    applyPaymentEvent(new ManualPaymentProvider("s"), paidEvent({ productId: "pro-credits" }));
    const product = getProduct("pro-credits")!;

    for (let i = 0; i < product.credits; i += 1) {
      reserveEntitlement("owner-1", "pro-credits");
    }
    expect(() => reserveEntitlement("owner-1", "pro-credits")).toThrowError(AppError);

    const [entitlement] = listEntitlements("owner-1");
    expect(entitlement?.creditsUsed).toBe(product.credits);
    expect(entitlement?.status).toBe("EXHAUSTED");
  });

  it("gives a credit back and reopens an exhausted entitlement", () => {
    applyPaymentEvent(new ManualPaymentProvider("s"), paidEvent());
    const entitlement = reserveEntitlement("owner-1", "deep-text");
    expect(listEntitlements("owner-1")[0]?.status).toBe("EXHAUSTED");

    releaseEntitlement(entitlement.id);
    expect(listEntitlements("owner-1")[0]?.status).toBe("ACTIVE");
    expect(checkEntitlement("owner-1", "deep-text").ok).toBe(true);
  });

  it("keeps one owner's entitlements away from another", () => {
    ensureOwner("owner-2");
    applyPaymentEvent(new ManualPaymentProvider("s"), paidEvent());

    expect(checkEntitlement("owner-1", "deep-text").ok).toBe(true);
    expect(checkEntitlement("owner-2", "deep-text").ok).toBe(false);
    expect(summarise("owner-2")).toHaveLength(0);
  });

  it("has a sensible default free limit", () => {
    expect(freeLimit()).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------
 * Webhook application
 * ---------------------------------------------------------------------- */

describe("applying a payment event", () => {
  const provider = new ManualPaymentProvider("secret");

  it("records the payment and grants exactly one entitlement", () => {
    const outcome = applyPaymentEvent(provider, paidEvent());
    expect(outcome.applied).toBe(true);
    expect(outcome.entitlementId).toBeTruthy();
    expect(listPayments("owner-1")).toHaveLength(1);
    expect(listEntitlements("owner-1")).toHaveLength(1);
  });

  it("ignores a redelivered event", () => {
    applyPaymentEvent(provider, paidEvent());
    const second = applyPaymentEvent(provider, paidEvent());

    expect(second.applied).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(listEntitlements("owner-1")).toHaveLength(1);
  });

  it("does not grant twice for the same payment reached by two event ids", () => {
    applyPaymentEvent(provider, paidEvent({ eventId: "evt_1" }));
    const second = applyPaymentEvent(provider, paidEvent({ eventId: "evt_2" }));

    // A new event id passes the ledger, but the payment already has an
    // entitlement, so no second one is created.
    expect(second.applied).toBe(true);
    expect(listEntitlements("owner-1")).toHaveLength(1);
  });

  it("records a failed payment without granting anything", () => {
    applyPaymentEvent(provider, paidEvent({ status: "FAILED" }));
    expect(listPayments("owner-1")[0]?.status).toBe("FAILED");
    expect(listEntitlements("owner-1")).toHaveLength(0);
  });

  it("ignores an event for a product that does not exist", () => {
    const outcome = applyPaymentEvent(provider, paidEvent({ productId: "made-up" }));
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe("unknown_product");
    expect(listEntitlements("owner-1")).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------
 * Signature verification
 * ---------------------------------------------------------------------- */

describe("manual provider signatures", () => {
  const provider = new ManualPaymentProvider("secret");
  const body = JSON.stringify(paidEvent());

  it("accepts a correctly signed body", () => {
    const headers = new Headers({ [MANUAL_SIGNATURE_HEADER]: provider.sign(body) });
    expect(provider.verifyWebhook(body, headers)?.reference).toBe("cs_1");
  });

  it("rejects a tampered body", () => {
    const headers = new Headers({ [MANUAL_SIGNATURE_HEADER]: provider.sign(body) });
    const tampered = body.replace('"amountMinor":900', '"amountMinor":1');
    expect(provider.verifyWebhook(tampered, headers)).toBeNull();
  });

  it("rejects a body signed with a different secret", () => {
    const other = new ManualPaymentProvider("other-secret");
    const headers = new Headers({ [MANUAL_SIGNATURE_HEADER]: other.sign(body) });
    expect(provider.verifyWebhook(body, headers)).toBeNull();
  });

  it("rejects a missing signature", () => {
    expect(provider.verifyWebhook(body, new Headers())).toBeNull();
  });
});

describe("stripe provider signatures", () => {
  const provider = new StripePaymentProvider("sk_test", "whsec_test");

  function sign(body: string, timestamp: number, secret = "whsec_test"): Headers {
    const signature = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    return new Headers({ "stripe-signature": `t=${timestamp},v1=${signature}` });
  }

  const body = JSON.stringify({
    id: "evt_stripe",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_stripe",
        amount_total: 900,
        currency: "eur",
        payment_status: "paid",
        metadata: { owner_id: "owner-1", product_id: "deep-text" },
      },
    },
  });

  it("is only available when both secrets are configured", () => {
    expect(provider.available).toBe(true);
    expect(new StripePaymentProvider("sk_test", "").available).toBe(false);
  });

  it("accepts a correctly signed event", () => {
    const event = provider.verifyWebhook(body, sign(body, Math.floor(Date.now() / 1000)));
    expect(event?.ownerId).toBe("owner-1");
    expect(event?.status).toBe("PAID");
  });

  it("rejects a stale timestamp, which is how a replay is caught", () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(provider.verifyWebhook(body, sign(body, old))).toBeNull();
  });

  it("rejects a signature made with the wrong secret", () => {
    const headers = sign(body, Math.floor(Date.now() / 1000), "whsec_wrong");
    expect(provider.verifyWebhook(body, headers)).toBeNull();
  });

  it("rejects a body that does not match the signature", () => {
    const headers = sign(body, Math.floor(Date.now() / 1000));
    expect(provider.verifyWebhook(`${body} `, headers)).toBeNull();
  });

  it("ignores an unpaid session and unrelated event types", () => {
    expect(
      toVerifiedEvent({
        id: "e",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs",
            payment_status: "unpaid",
            metadata: { owner_id: "o", product_id: "p" },
          },
        },
      }),
    ).toBeNull();

    expect(
      toVerifiedEvent({
        id: "e",
        type: "customer.created",
        data: { object: { id: "c", metadata: { owner_id: "o", product_id: "p" } } },
      }),
    ).toBeNull();
  });

  it("ignores an event with no owner metadata, rather than guessing", () => {
    expect(
      toVerifiedEvent({
        id: "e",
        type: "checkout.session.completed",
        data: { object: { id: "cs", payment_status: "paid", metadata: {} } },
      }),
    ).toBeNull();
  });
});

describe("pricing", () => {
  it("formats free and paid products differently", () => {
    expect(formatPrice(getProduct("free")!)).toBe("Free");
    expect(formatPrice(getProduct("deep-text")!)).toMatch(/\d/);
  });

  it("keeps money in minor units, so no float rounding reaches storage", () => {
    for (const product of [getProduct("deep-text")!, getProduct("pro-credits")!]) {
      expect(Number.isInteger(product.priceMinor)).toBe(true);
    }
  });
});
