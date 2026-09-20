/**
 * The provider used when no real payment provider is configured.
 *
 * It does not pretend a charge happened. Checkout sends the browser to a page
 * that says plainly that this build is running without a payment provider, and
 * confirming there posts a signed event through the same webhook path a real
 * provider would use. That keeps one rule intact: entitlements are only ever
 * created from a server-verified event, never because the frontend said so.
 */

import crypto from "node:crypto";

import type {
  CheckoutInput,
  CheckoutSession,
  PaymentProvider,
  VerifiedPaymentEvent,
} from "./types";

export const MANUAL_SIGNATURE_HEADER = "x-manual-signature";

export class ManualPaymentProvider implements PaymentProvider {
  readonly id = "manual";
  readonly available = true;
  readonly simulated = true;

  constructor(private readonly secret: string) {}

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const reference = `manual_${crypto.randomUUID().replace(/-/g, "")}`;
    const params = new URLSearchParams({
      reference,
      product: input.productId,
      next: input.successUrl,
      cancel: input.cancelUrl,
    });
    return { url: `/checkout/confirm?${params.toString()}`, reference };
  }

  /** Deterministic signature over the event body, same shape as a real one. */
  sign(rawBody: string): string {
    return crypto.createHmac("sha256", this.secret).update(rawBody).digest("hex");
  }

  verifyWebhook(rawBody: string, headers: Headers): VerifiedPaymentEvent | null {
    const given = headers.get(MANUAL_SIGNATURE_HEADER);
    if (!given) return null;

    const expected = Buffer.from(this.sign(rawBody));
    const provided = Buffer.from(given);
    if (
      provided.length !== expected.length ||
      !crypto.timingSafeEqual(provided, expected)
    ) {
      return null;
    }

    let parsed: Partial<VerifiedPaymentEvent>;
    try {
      parsed = JSON.parse(rawBody) as Partial<VerifiedPaymentEvent>;
    } catch {
      return null;
    }

    if (
      !parsed.eventId ||
      !parsed.reference ||
      !parsed.ownerId ||
      !parsed.productId ||
      !parsed.status
    ) {
      return null;
    }

    return {
      eventId: parsed.eventId,
      type: parsed.type ?? "manual.completed",
      reference: parsed.reference,
      ownerId: parsed.ownerId,
      productId: parsed.productId,
      amountMinor: parsed.amountMinor ?? 0,
      currency: parsed.currency ?? "EUR",
      status: parsed.status,
    };
  }
}
