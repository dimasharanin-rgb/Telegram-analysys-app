/**
 * Consent requests and their audit trail.
 *
 * Tokens are never stored: only a SHA-256 hash, so a leaked database copy
 * cannot be used to open anyone's consent link. Status changes go through
 * `transition()`, which refuses moves the state machine does not allow and
 * writes an audit row in the same transaction as the change itself.
 */

import crypto from "node:crypto";

import {
  assertTransition,
  effectiveStatus,
  type ConsentDataType,
  type ConsentEvent,
  type ConsentStatus,
} from "@/lib/consent/state";
import { getDb } from "@/server/db/client";
import { newId, nowIso } from "@/server/ids";

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export interface ConsentRequestRecord {
  id: string;
  ownerId: string;
  conversationId: string;
  participantId: string;
  requestedByLabel: string;
  dataTypes: ConsentDataType[];
  purpose: string;
  aiProvider: string;
  documentVersion: string;
  status: ConsentStatus;
  createdAt: string;
  expiresAt: string;
  viewedAt: string | null;
  decidedAt: string | null;
  withdrawnAt: string | null;
}

export interface ConsentAuditEntry {
  id: string;
  consentRequestId: string;
  event: ConsentEvent;
  actor: "requester" | "participant" | "system";
  detail: string | null;
  at: string;
}

interface ConsentRow {
  id: string;
  owner_id: string;
  conversation_id: string;
  participant_id: string;
  requested_by_label: string;
  token_hash: string;
  data_types: string;
  purpose: string;
  ai_provider: string;
  document_version: string;
  status: string;
  created_at: string;
  expires_at: string;
  viewed_at: string | null;
  decided_at: string | null;
  withdrawn_at: string | null;
}

interface AuditRow {
  id: string;
  consent_request_id: string;
  event: string;
  actor: string;
  detail: string | null;
  at: string;
}

/**
 * Applies expiry at read time so a request whose deadline has passed can never
 * be presented as still open, whatever is stored.
 */
function toRecord(row: ConsentRow): ConsentRequestRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    conversationId: row.conversation_id,
    participantId: row.participant_id,
    requestedByLabel: row.requested_by_label,
    dataTypes: JSON.parse(row.data_types) as ConsentDataType[],
    purpose: row.purpose,
    aiProvider: row.ai_provider,
    documentVersion: row.document_version,
    status: effectiveStatus(row.status as ConsentStatus, row.expires_at),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    viewedAt: row.viewed_at,
    decidedAt: row.decided_at,
    withdrawnAt: row.withdrawn_at,
  };
}

function toAudit(row: AuditRow): ConsentAuditEntry {
  return {
    id: row.id,
    consentRequestId: row.consent_request_id,
    event: row.event as ConsentEvent,
    actor: row.actor as ConsentAuditEntry["actor"],
    detail: row.detail,
    at: row.at,
  };
}

export interface CreateConsentInput {
  ownerId: string;
  conversationId: string;
  participantId: string;
  requestedByLabel: string;
  dataTypes: ConsentDataType[];
  purpose: string;
  aiProvider: string;
  documentVersion: string;
  expiresAt: string;
}

export interface CreatedConsent {
  request: ConsentRequestRecord;
  /** Returned once, to build the link. Never retrievable afterwards. */
  token: string;
}

export function createConsentRequest(input: CreateConsentInput): CreatedConsent {
  const db = getDb();
  const id = newId("csr");
  const token = generateToken();
  const at = nowIso();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO consent_requests
         (id, owner_id, conversation_id, participant_id, requested_by_label,
          token_hash, data_types, purpose, ai_provider, document_version,
          status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    ).run(
      id,
      input.ownerId,
      input.conversationId,
      input.participantId,
      input.requestedByLabel,
      hashToken(token),
      JSON.stringify(input.dataTypes),
      input.purpose,
      input.aiProvider,
      input.documentVersion,
      at,
      input.expiresAt,
    );
    insertAudit(id, "REQUESTED", "requester", {
      dataTypes: input.dataTypes.join(","),
      documentVersion: input.documentVersion,
    });
  })();

  return { request: getConsentRequest(id)!, token };
}

function insertAudit(
  consentRequestId: string,
  event: ConsentEvent,
  actor: ConsentAuditEntry["actor"],
  detail?: Record<string, string | number | boolean>,
): void {
  getDb()
    .prepare(
      `INSERT INTO consent_audit (id, consent_request_id, event, actor, detail, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId("aud"),
      consentRequestId,
      event,
      actor,
      detail ? JSON.stringify(detail) : null,
      nowIso(),
    );
}

/** Audit entries that are not state changes, e.g. an analysis being blocked. */
export function appendAudit(
  consentRequestId: string,
  event: ConsentEvent,
  actor: ConsentAuditEntry["actor"],
  detail?: Record<string, string | number | boolean>,
): void {
  insertAudit(consentRequestId, event, actor, detail);
}

export function getConsentRequest(id: string): ConsentRequestRecord | null {
  const row = getDb()
    .prepare<[string], ConsentRow>("SELECT * FROM consent_requests WHERE id = ?")
    .get(id);
  return row ? toRecord(row) : null;
}

export function findByToken(token: string): ConsentRequestRecord | null {
  const row = getDb()
    .prepare<[string], ConsentRow>("SELECT * FROM consent_requests WHERE token_hash = ?")
    .get(hashToken(token));
  return row ? toRecord(row) : null;
}

export function listConsentForConversation(
  conversationId: string,
): ConsentRequestRecord[] {
  return getDb()
    .prepare<[string], ConsentRow>(
      "SELECT * FROM consent_requests WHERE conversation_id = ? ORDER BY created_at ASC",
    )
    .all(conversationId)
    .map(toRecord);
}

export function listAudit(consentRequestId: string): ConsentAuditEntry[] {
  return getDb()
    .prepare<[string], AuditRow>(
      "SELECT * FROM consent_audit WHERE consent_request_id = ? ORDER BY at ASC, rowid ASC",
    )
    .all(consentRequestId)
    .map(toAudit);
}

const TIMESTAMP_COLUMN: Partial<Record<ConsentStatus, string>> = {
  VIEWED: "viewed_at",
  ACCEPTED: "decided_at",
  DECLINED: "decided_at",
  WITHDRAWN: "withdrawn_at",
};

const STATUS_EVENT: Record<ConsentStatus, ConsentEvent> = {
  PENDING: "REQUESTED",
  VIEWED: "VIEWED",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  WITHDRAWN: "WITHDRAWN",
  EXPIRED: "EXPIRED",
};

/**
 * Moves a consent request to a new status, refusing transitions the state
 * machine does not allow. The status change and its audit row are written
 * together, so the trail cannot drift from the record.
 */
export function transition(
  id: string,
  to: ConsentStatus,
  actor: ConsentAuditEntry["actor"],
  detail?: Record<string, string | number | boolean>,
): ConsentRequestRecord {
  const db = getDb();
  const current = getConsentRequest(id);
  if (!current) throw new Error(`Unknown consent request ${id}`);

  assertTransition(current.status, to);

  const at = nowIso();
  const column = TIMESTAMP_COLUMN[to];

  db.transaction(() => {
    if (column) {
      db.prepare(
        `UPDATE consent_requests SET status = ?, ${column} = ? WHERE id = ?`,
      ).run(to, at, id);
    } else {
      db.prepare("UPDATE consent_requests SET status = ? WHERE id = ?").run(to, id);
    }
    insertAudit(id, STATUS_EVENT[to], actor, detail);
  })();

  return getConsentRequest(id)!;
}

/**
 * Writes EXPIRED for requests whose deadline has passed. Reads already treat
 * them as expired; this makes the stored record and the audit trail agree.
 */
export function expireOverdue(now: string = nowIso()): number {
  const db = getDb();
  const overdue = db
    .prepare<[string], { id: string }>(
      `SELECT id FROM consent_requests
        WHERE status IN ('PENDING', 'VIEWED') AND expires_at <= ?`,
    )
    .all(now);

  for (const row of overdue) {
    db.transaction(() => {
      db.prepare("UPDATE consent_requests SET status = 'EXPIRED' WHERE id = ?").run(row.id);
      insertAudit(row.id, "EXPIRED", "system");
    })();
  }
  return overdue.length;
}
