/**
 * Payments, entitlements and the webhook idempotency ledger.
 *
 * Three separate ideas, kept separate on purpose:
 *   - a payment is a record that money moved,
 *   - an entitlement is authorisation to run something,
 *   - a job consumes an entitlement.
 *
 * Entitlements are only ever created here, from a verified provider event or
 * an explicit server-side grant. Nothing the browser says can produce one.
 */

import { getDb } from "@/server/db/client";
import { newId, nowIso } from "@/server/ids";

export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED";
export type EntitlementStatus = "ACTIVE" | "EXHAUSTED" | "REVOKED" | "EXPIRED";

export interface PaymentRecord {
  id: string;
  ownerId: string;
  provider: string;
  providerRef: string;
  productId: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EntitlementRecord {
  id: string;
  ownerId: string;
  productId: string;
  source: "purchase" | "free" | "grant";
  paymentId: string | null;
  creditsTotal: number;
  creditsUsed: number;
  status: EntitlementStatus;
  createdAt: string;
  expiresAt: string | null;
}

interface PaymentRow {
  id: string;
  owner_id: string;
  provider: string;
  provider_ref: string;
  product_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface EntitlementRow {
  id: string;
  owner_id: string;
  product_id: string;
  source: string;
  payment_id: string | null;
  credits_total: number;
  credits_used: number;
  status: string;
  created_at: string;
  expires_at: string | null;
}

function toPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    provider: row.provider,
    providerRef: row.provider_ref,
    productId: row.product_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    status: row.status as PaymentStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEntitlement(row: EntitlementRow): EntitlementRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    productId: row.product_id,
    source: row.source as EntitlementRecord["source"],
    paymentId: row.payment_id,
    creditsTotal: row.credits_total,
    creditsUsed: row.credits_used,
    status: row.status as EntitlementStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/* -------------------------------------------------------------------------
 * Payments
 * ---------------------------------------------------------------------- */

export interface UpsertPaymentInput {
  ownerId: string;
  provider: string;
  providerRef: string;
  productId: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
}

/**
 * Keyed on (provider, providerRef), so a retried checkout or a redelivered
 * webhook updates the same row rather than creating a second payment.
 */
export function upsertPayment(input: UpsertPaymentInput): PaymentRecord {
  const db = getDb();
  const at = nowIso();
  db.prepare(
    `INSERT INTO payments
       (id, owner_id, provider, provider_ref, product_id, amount_minor, currency,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_ref) DO UPDATE SET
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(
    newId("pay"),
    input.ownerId,
    input.provider,
    input.providerRef,
    input.productId,
    input.amountMinor,
    input.currency,
    input.status,
    at,
    at,
  );
  return getPaymentByRef(input.provider, input.providerRef)!;
}

export function getPaymentByRef(
  provider: string,
  providerRef: string,
): PaymentRecord | null {
  const row = getDb()
    .prepare<[string, string], PaymentRow>(
      "SELECT * FROM payments WHERE provider = ? AND provider_ref = ?",
    )
    .get(provider, providerRef);
  return row ? toPayment(row) : null;
}

export function listPayments(ownerId: string, limit = 50): PaymentRecord[] {
  return getDb()
    .prepare<[string, number], PaymentRow>(
      "SELECT * FROM payments WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(ownerId, limit)
    .map(toPayment);
}

/* -------------------------------------------------------------------------
 * Entitlements
 * ---------------------------------------------------------------------- */

export interface CreateEntitlementInput {
  ownerId: string;
  productId: string;
  source: EntitlementRecord["source"];
  paymentId?: string | null;
  creditsTotal: number;
  expiresAt?: string | null;
}

export function createEntitlement(input: CreateEntitlementInput): EntitlementRecord {
  const id = newId("ent");
  getDb()
    .prepare(
      `INSERT INTO entitlements
         (id, owner_id, product_id, source, payment_id, credits_total, credits_used,
          status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'ACTIVE', ?, ?)`,
    )
    .run(
      id,
      input.ownerId,
      input.productId,
      input.source,
      input.paymentId ?? null,
      input.creditsTotal,
      nowIso(),
      input.expiresAt ?? null,
    );
  return getEntitlement(id)!;
}

export function getEntitlement(id: string): EntitlementRecord | null {
  const row = getDb()
    .prepare<[string], EntitlementRow>("SELECT * FROM entitlements WHERE id = ?")
    .get(id);
  return row ? toEntitlement(row) : null;
}

/** An entitlement already created for this payment, if any. */
export function findEntitlementByPayment(paymentId: string): EntitlementRecord | null {
  const row = getDb()
    .prepare<[string], EntitlementRow>("SELECT * FROM entitlements WHERE payment_id = ?")
    .get(paymentId);
  return row ? toEntitlement(row) : null;
}

export function listEntitlements(ownerId: string): EntitlementRecord[] {
  return getDb()
    .prepare<[string], EntitlementRow>(
      "SELECT * FROM entitlements WHERE owner_id = ? ORDER BY created_at DESC",
    )
    .all(ownerId)
    .map(toEntitlement);
}

/** The oldest usable entitlement for a product, so credits are spent in order. */
export function findUsableEntitlement(
  ownerId: string,
  productId: string,
  now: string = nowIso(),
): EntitlementRecord | null {
  const row = getDb()
    .prepare<[string, string, string], EntitlementRow>(
      `SELECT * FROM entitlements
        WHERE owner_id = ?
          AND product_id = ?
          AND status = 'ACTIVE'
          AND credits_used < credits_total
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at ASC
        LIMIT 1`,
    )
    .get(ownerId, productId, now);
  return row ? toEntitlement(row) : null;
}

/**
 * Spends one credit. The guard is in the UPDATE itself, so two concurrent
 * requests cannot both spend the last credit.
 */
export function consumeCredit(entitlementId: string): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE entitlements
          SET credits_used = credits_used + 1,
              status = CASE WHEN credits_used + 1 >= credits_total THEN 'EXHAUSTED' ELSE status END
        WHERE id = ? AND status = 'ACTIVE' AND credits_used < credits_total`,
    )
    .run(entitlementId);
  return result.changes > 0;
}

/** Returns a spent credit, used when a job fails before producing anything. */
export function refundCredit(entitlementId: string): void {
  getDb()
    .prepare(
      `UPDATE entitlements
          SET credits_used = MAX(0, credits_used - 1),
              status = CASE WHEN status = 'EXHAUSTED' THEN 'ACTIVE' ELSE status END
        WHERE id = ?`,
    )
    .run(entitlementId);
}

/* -------------------------------------------------------------------------
 * Webhook idempotency
 * ---------------------------------------------------------------------- */

/**
 * Claims a provider event. Returns false when it has been seen before, which
 * is how a redelivered webhook is stopped from granting a second entitlement.
 */
export function claimWebhookEvent(
  provider: string,
  eventId: string,
  eventType: string,
): boolean {
  const result = getDb()
    .prepare(
      `INSERT INTO webhook_events (provider, event_id, event_type, received_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider, event_id) DO NOTHING`,
    )
    .run(provider, eventId, eventType, nowIso());
  return result.changes > 0;
}
