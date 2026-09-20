/**
 * POST /api/checkout/confirm — completes a simulated purchase.
 *
 * Only reachable when no real payment provider is configured. It exists so the
 * entitlement flow can be exercised end to end without payment credentials,
 * and it deliberately goes the long way round: it builds a provider event,
 * signs it, and puts it through the same verification and idempotency path a
 * real webhook uses. Nothing here shortcuts into the entitlement table.
 */

import crypto from "node:crypto";

import { manualConfirmSchema } from "@/lib/api/schemas";
import { getProduct } from "@/lib/billing/products";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { json, readJson, withOwner } from "@/server/http";
import { ManualPaymentProvider, MANUAL_SIGNATURE_HEADER } from "@/server/payments/manual";
import { applyPaymentEvent, paymentProvider } from "@/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withOwner(
  async ({ ownerId, request }) => {
    const provider = paymentProvider();
    if (!(provider instanceof ManualPaymentProvider)) {
      throw new AppError("NOT_FOUND", {
        message: "This application is configured with a real payment provider.",
      });
    }

    const parsed = manualConfirmSchema.safeParse(await readJson(request, 4_096));
    if (!parsed.success) throw new AppError("INVALID_REQUEST");

    const product = getProduct(parsed.data.productId);
    if (!product || !product.available) throw new AppError("PRODUCT_UNAVAILABLE");

    const body = JSON.stringify({
      eventId: `manual_evt_${crypto.randomUUID().replace(/-/g, "")}`,
      type: "manual.completed",
      reference: parsed.data.reference,
      ownerId,
      productId: product.id,
      amountMinor: product.priceMinor,
      currency: product.currency,
      status: "PAID",
    });

    const headers = new Headers({ [MANUAL_SIGNATURE_HEADER]: provider.sign(body) });
    const event = provider.verifyWebhook(body, headers);
    if (!event) throw new AppError("PAYMENT_FAILED");

    const outcome = applyPaymentEvent(provider, event);
    log.info("checkout.manual_confirmed", { productId: product.id });

    return json({ ...outcome, simulated: true });
  },
  { rateLimit: true },
);
