/**
 * POST /api/checkout — start a purchase.
 *
 * Returns a URL to send the browser to. It does not grant anything: the
 * entitlement is created later, by the webhook, from an event the provider
 * signed.
 */

import { checkoutSchema } from "@/lib/api/schemas";
import { getProduct, isFree } from "@/lib/billing/products";
import { serverConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { json, readJson, withOwner } from "@/server/http";
import { paymentProvider } from "@/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only same-origin paths, so a checkout link cannot become an open redirect. */
function safePath(path: string | undefined): string {
  if (!path) return "/analyze";
  return /^\/[A-Za-z0-9\-._~/?#[\]@!$&'()*+,;=%]*$/.test(path) && !path.startsWith("//")
    ? path
    : "/analyze";
}

export const POST = withOwner(
  async ({ ownerId, request }) => {
    const parsed = checkoutSchema.safeParse(await readJson(request, 8_192));
    if (!parsed.success) throw new AppError("INVALID_REQUEST");

    const product = getProduct(parsed.data.productId);
    if (!product || !product.available) {
      throw new AppError("PRODUCT_UNAVAILABLE", {
        ...(product?.unavailableReason ? { message: product.unavailableReason } : {}),
      });
    }
    if (isFree(product)) {
      throw new AppError("INVALID_REQUEST", {
        message: "That option is free — there's nothing to pay for.",
      });
    }

    const config = serverConfig();
    const base = config.consent.appUrl;
    const returnPath = safePath(parsed.data.returnPath);
    const provider = paymentProvider();

    const session = await provider.createCheckout({
      ownerId,
      productId: product.id,
      amountMinor: product.priceMinor,
      currency: product.currency,
      productName: product.name,
      successUrl: `${base}${returnPath}${returnPath.includes("?") ? "&" : "?"}paid=1`,
      cancelUrl: `${base}${returnPath}`,
    });

    log.info("checkout.created", { provider: provider.id, productId: product.id });

    return json({
      url: session.url.startsWith("/") ? session.url : session.url,
      provider: provider.id,
      simulated: provider.simulated,
    });
  },
  { rateLimit: true },
);
