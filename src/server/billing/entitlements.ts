/**
 * Entitlement service.
 *
 * The single question the analysis engine asks: "may this owner run this
 * product?". Answering it is the only thing that unlocks a job — never a
 * checkout redirect, never a flag from the browser.
 *
 * Free products get an entitlement granted on demand, up to a per-owner
 * ceiling, so the same reserve/release mechanism covers paid and free alike.
 */

import { getProduct, isFree, type AnalysisProduct } from "@/lib/billing/products";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import * as billing from "@/server/repositories/billing";
import type { EntitlementRecord } from "@/server/repositories/billing";

function freeLimit(): number {
  const raw = Number(process.env.FREE_ANALYSES_PER_OWNER);
  return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 3;
}

function freeGrantsUsed(ownerId: string): number {
  return billing
    .listEntitlements(ownerId)
    .filter((entitlement) => entitlement.source === "free")
    .reduce((sum, entitlement) => sum + entitlement.creditsTotal, 0);
}

export interface EntitlementCheck {
  ok: boolean;
  entitlement?: EntitlementRecord;
  /** Why it is not available, when it is not. */
  reason?: "requires_purchase" | "free_limit_reached" | "unknown_product" | "unavailable";
}

/** Read-only check, used to decide what the UI offers. */
export function checkEntitlement(ownerId: string, productId: string): EntitlementCheck {
  const product = getProduct(productId);
  if (!product) return { ok: false, reason: "unknown_product" };
  if (!product.available) return { ok: false, reason: "unavailable" };

  const existing = billing.findUsableEntitlement(ownerId, productId);
  if (existing) return { ok: true, entitlement: existing };

  if (isFree(product)) {
    return freeGrantsUsed(ownerId) < freeLimit()
      ? { ok: true }
      : { ok: false, reason: "free_limit_reached" };
  }
  return { ok: false, reason: "requires_purchase" };
}

function grantFree(ownerId: string, product: AnalysisProduct): EntitlementRecord {
  const entitlement = billing.createEntitlement({
    ownerId,
    productId: product.id,
    source: "free",
    creditsTotal: product.credits,
  });
  log.info("entitlement.free_granted", { entitlementId: entitlement.id });
  return entitlement;
}

/**
 * Takes one credit for a run. Returns the entitlement whose credit was spent,
 * so it can be handed back if the job fails before producing anything.
 */
export function reserveEntitlement(ownerId: string, productId: string): EntitlementRecord {
  const product = getProduct(productId);
  if (!product) throw new AppError("PRODUCT_UNAVAILABLE", { detail: productId });
  if (!product.available) {
    throw new AppError("PRODUCT_UNAVAILABLE", {
      message: product.unavailableReason ?? "That option isn't available yet.",
    });
  }

  let entitlement = billing.findUsableEntitlement(ownerId, productId);

  if (!entitlement && isFree(product)) {
    if (freeGrantsUsed(ownerId) >= freeLimit()) {
      throw new AppError("ENTITLEMENT_REQUIRED", {
        message: `You've used all ${freeLimit()} free analyses.`,
        hint: "Choose a paid option to run another one.",
      });
    }
    entitlement = grantFree(ownerId, product);
  }

  if (!entitlement) throw new AppError("ENTITLEMENT_REQUIRED");

  // The guard lives in the UPDATE, so two parallel requests cannot both spend
  // the last credit.
  if (!billing.consumeCredit(entitlement.id)) {
    throw new AppError("ENTITLEMENT_REQUIRED", {
      detail: "credit could not be consumed",
    });
  }

  log.info("entitlement.reserved", {
    entitlementId: entitlement.id,
    productId,
  });
  return entitlement;
}

/** Hands a credit back when a job failed before producing a result. */
export function releaseEntitlement(entitlementId: string): void {
  billing.refundCredit(entitlementId);
  log.info("entitlement.released", { entitlementId });
}

export interface EntitlementSummary {
  productId: string;
  productName: string;
  creditsRemaining: number;
  creditsTotal: number;
  source: EntitlementRecord["source"];
  status: EntitlementRecord["status"];
  createdAt: string;
}

export function summarise(ownerId: string): EntitlementSummary[] {
  return billing.listEntitlements(ownerId).map((entitlement) => ({
    productId: entitlement.productId,
    productName: getProduct(entitlement.productId)?.name ?? entitlement.productId,
    creditsRemaining: Math.max(0, entitlement.creditsTotal - entitlement.creditsUsed),
    creditsTotal: entitlement.creditsTotal,
    source: entitlement.source,
    status: entitlement.status,
    createdAt: entitlement.createdAt,
  }));
}

export { freeLimit };
