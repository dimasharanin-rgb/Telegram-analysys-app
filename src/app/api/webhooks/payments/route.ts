/**
 * POST /api/webhooks/payments — the authoritative source of entitlements.
 *
 * The body is verified against the provider's signature before anything is
 * read from it, and the event id is claimed in a ledger so a redelivery - which
 * every provider does eventually - cannot grant a second entitlement.
 *
 * A rejected signature returns 400 without detail. A duplicate returns 200,
 * because telling the provider "already handled" is what stops it retrying.
 */

import { log } from "@/lib/logger";
import { applyPaymentEvent, paymentProvider } from "@/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  const provider = paymentProvider();

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return new Response("payload too large", { status: 413 });
  }

  const event = provider.verifyWebhook(raw, request.headers);
  if (!event) {
    log.warn("payments.webhook_rejected", { provider: provider.id });
    return new Response("invalid signature", { status: 400 });
  }

  try {
    const outcome = applyPaymentEvent(provider, event);
    return new Response(JSON.stringify({ received: true, ...outcome }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    // A 500 makes the provider retry, which is what we want for a transient
    // failure - the idempotency ledger makes the retry safe.
    log.error("payments.webhook_failed", {
      provider: provider.id,
      detail: error instanceof Error ? error.message : "unknown",
    });
    return new Response("processing failed", { status: 500 });
  }
}
