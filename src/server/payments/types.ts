/**
 * Payment provider abstraction.
 *
 * The analysis engine knows nothing about payments. It asks the entitlement
 * service whether an owner may run a product; entitlements are created only
 * from an event a provider has verified. Swapping provider means implementing
 * this interface - no other file changes.
 */

export interface CheckoutInput {
  ownerId: string;
  productId: string;
  amountMinor: number;
  currency: string;
  productName: string;
  /** Where the browser returns after a successful payment. */
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Where to send the browser. */
  url: string;
  /** The provider's identifier for this attempt, stored as `provider_ref`. */
  reference: string;
}

export type PaymentEventStatus = "PAID" | "FAILED" | "REFUNDED";

/**
 * A provider event, already verified. Only these fields are trusted - anything
 * else in the provider's payload is ignored.
 */
export interface VerifiedPaymentEvent {
  /** Provider event id, used for idempotency. */
  eventId: string;
  type: string;
  reference: string;
  ownerId: string;
  productId: string;
  amountMinor: number;
  currency: string;
  status: PaymentEventStatus;
}

export interface PaymentProvider {
  readonly id: string;
  /** False when the provider has no credentials configured. */
  readonly available: boolean;
  /**
   * True when this provider grants entitlements without money actually
   * moving, so the UI can say so plainly instead of implying a real charge.
   */
  readonly simulated: boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  /**
   * Verifies an incoming webhook. Returns null when the signature does not
   * check out or the event is not one we act on.
   */
  verifyWebhook(rawBody: string, headers: Headers): VerifiedPaymentEvent | null;
}
