/**
 * Stripe provider, implemented against Stripe's HTTP API directly.
 *
 * No SDK dependency: a Checkout Session is one form-encoded POST, and webhook
 * verification is an HMAC over `timestamp.body`. Doing it here keeps the
 * dependency list short and makes the security-relevant part - the signature
 * check - readable rather than hidden behind a library call.
 */

import crypto from "node:crypto";

import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import type {
  CheckoutInput,
  CheckoutSession,
  PaymentProvider,
  VerifiedPaymentEvent,
} from "./types";

const API = "https://api.stripe.com/v1";

/** Stripe rejects a signature older than this; so do we. */
const TOLERANCE_SECONDS = 5 * 60;

export class StripePaymentProvider implements PaymentProvider {
  readonly id = "stripe";
  readonly simulated = false;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  get available(): boolean {
    return this.secretKey.length > 0 && this.webhookSecret.length > 0;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    // The owner and product travel as metadata, so the webhook can attribute
    // the payment without trusting anything the browser sends back.
    const body = new URLSearchParams({
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(input.amountMinor),
      "line_items[0][price_data][product_data][name]": input.productName,
      "metadata[owner_id]": input.ownerId,
      "metadata[product_id]": input.productId,
      "payment_intent_data[metadata][owner_id]": input.ownerId,
      "payment_intent_data[metadata][product_id]": input.productId,
      client_reference_id: input.ownerId,
    });

    const response = await fetch(`${API}/checkout/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      log.error("payments.checkout_failed", {
        provider: this.id,
        status: response.status,
      });
      throw new AppError("PAYMENT_FAILED", {
        detail: `stripe checkout ${response.status}`,
      });
    }

    const session = (await response.json()) as { id?: string; url?: string };
    if (!session.id || !session.url) {
      throw new AppError("PAYMENT_FAILED", { detail: "stripe returned no session url" });
    }
    return { url: session.url, reference: session.id };
  }

  verifyWebhook(rawBody: string, headers: Headers): VerifiedPaymentEvent | null {
    const header = headers.get("stripe-signature");
    if (!header) return null;
    if (!this.verifySignature(rawBody, header)) {
      log.warn("payments.webhook_signature_rejected", { provider: this.id });
      return null;
    }

    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody) as StripeEvent;
    } catch {
      return null;
    }
    return toVerifiedEvent(event);
  }

  private verifySignature(rawBody: string, header: string): boolean {
    // Header shape: t=<unix>,v1=<hex>[,v1=<hex>...]
    let timestamp = "";
    const candidates: string[] = [];
    for (const part of header.split(",")) {
      const [key, value] = part.split("=", 2);
      if (key === "t" && value) timestamp = value;
      if (key === "v1" && value) candidates.push(value);
    }
    if (!timestamp || candidates.length === 0) return false;

    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

    const expected = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    const expectedBuffer = Buffer.from(expected);

    return candidates.some((candidate) => {
      const given = Buffer.from(candidate);
      return (
        given.length === expectedBuffer.length &&
        crypto.timingSafeEqual(given, expectedBuffer)
      );
    });
  }
}

interface StripeEvent {
  id?: string;
  type?: string;
  data?: {
    object?: {
      id?: string;
      amount_total?: number;
      currency?: string;
      payment_status?: string;
      metadata?: Record<string, string>;
    };
  };
}

/** Maps the handful of Stripe events we act on; everything else is ignored. */
export function toVerifiedEvent(event: StripeEvent): VerifiedPaymentEvent | null {
  const object = event.data?.object;
  if (!event.id || !event.type || !object?.id) return null;

  const ownerId = object.metadata?.owner_id;
  const productId = object.metadata?.product_id;
  if (!ownerId || !productId) return null;

  let status: VerifiedPaymentEvent["status"];
  if (event.type === "checkout.session.completed") {
    if (object.payment_status !== "paid") return null;
    status = "PAID";
  } else if (
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    status = "FAILED";
  } else if (event.type === "charge.refunded") {
    status = "REFUNDED";
  } else {
    return null;
  }

  return {
    eventId: event.id,
    type: event.type,
    reference: object.id,
    ownerId,
    productId,
    amountMinor: object.amount_total ?? 0,
    currency: (object.currency ?? "eur").toUpperCase(),
    status,
  };
}
