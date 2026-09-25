/**
 * The media plan and what became of it.
 *
 * A row is created before any bytes exist, and that row is the permission to
 * upload one file. An upload naming a reference with no row is refused - which
 * is what makes "uploaded media" mean "a file this owner's own export listed"
 * rather than "whatever was POSTed".
 */

import { getDb } from "@/server/db/client";
import { newId, nowIso } from "@/server/ids";
import type { MediaCategory } from "@/lib/media/policy";
import type { MediaClassification, WithheldReason } from "@/lib/media/classification";
import type { MediaShape, TranscriptionStatus } from "@/lib/model/event";

export type MediaAssetStatus = "REQUESTED" | "STORED" | "REJECTED" | "PROCESSED";

export interface MediaAssetRecord {
  id: string;
  jobId: string;
  ownerId: string;
  messageId: string;
  reference: string;
  category: MediaCategory;
  mimeType: string;
  declaredSizeBytes: number;
  storageKey: string | null;
  storedSizeBytes: number | null;
  status: MediaAssetStatus;
  classification: MediaClassification | null;
  withheldReason: WithheldReason | null;
  description: string | null;
  extractedText: string | null;
  shape: MediaShape | null;
  transcriptStatus: TranscriptionStatus | null;
  transcriptText: string | null;
  transcriptLanguage: string | null;
  createdAt: string;
  processedAt: string | null;
}

interface Row {
  id: string;
  job_id: string;
  owner_id: string;
  message_id: string;
  reference: string;
  category: string;
  mime_type: string;
  declared_size_bytes: number;
  storage_key: string | null;
  stored_size_bytes: number | null;
  status: string;
  classification: string | null;
  withheld_reason: string | null;
  description: string | null;
  extracted_text: string | null;
  shape: string | null;
  transcript_status: string | null;
  transcript_text: string | null;
  transcript_language: string | null;
  created_at: string;
  processed_at: string | null;
}

function toRecord(row: Row): MediaAssetRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    ownerId: row.owner_id,
    messageId: row.message_id,
    reference: row.reference,
    category: row.category as MediaCategory,
    mimeType: row.mime_type,
    declaredSizeBytes: row.declared_size_bytes,
    storageKey: row.storage_key,
    storedSizeBytes: row.stored_size_bytes,
    status: row.status as MediaAssetStatus,
    classification: row.classification as MediaClassification | null,
    withheldReason: row.withheld_reason as WithheldReason | null,
    description: row.description,
    extractedText: row.extracted_text,
    shape: row.shape as MediaShape | null,
    transcriptStatus: row.transcript_status as TranscriptionStatus | null,
    transcriptText: row.transcript_text,
    transcriptLanguage: row.transcript_language,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  };
}

export interface PlannedAsset {
  messageId: string;
  reference: string;
  category: MediaCategory;
  mimeType: string;
  declaredSizeBytes: number;
}

/**
 * Records what this analysis intends to look at.
 *
 * `INSERT OR IGNORE` against the unique (job, reference) index, so planning is
 * idempotent: an export that lists the same file on two messages produces one
 * row and one upload rather than two.
 */
export function planMedia(
  jobId: string,
  ownerId: string,
  assets: readonly PlannedAsset[],
): number {
  if (assets.length === 0) return 0;
  const db = getDb();
  const at = nowIso();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO media_assets (
      id, job_id, owner_id, message_id, reference, category, mime_type,
      declared_size_bytes, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?)
  `);

  const run = db.transaction((items: readonly PlannedAsset[]) => {
    let planned = 0;
    for (const asset of items) {
      const result = insert.run(
        newId("med"),
        jobId,
        ownerId,
        asset.messageId,
        asset.reference,
        asset.category,
        asset.mimeType,
        asset.declaredSizeBytes,
        at,
      );
      planned += result.changes;
    }
    return planned;
  });

  return run(assets);
}

export function listMediaAssets(jobId: string, ownerId: string): MediaAssetRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM media_assets WHERE job_id = ? AND owner_id = ? ORDER BY created_at, reference`,
    )
    .all(jobId, ownerId) as Row[];
  return rows.map(toRecord);
}

/** One asset, scoped by owner so a job id alone cannot reach another's media. */
export function findMediaAsset(
  jobId: string,
  ownerId: string,
  reference: string,
): MediaAssetRecord | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM media_assets WHERE job_id = ? AND owner_id = ? AND reference = ?`,
    )
    .get(jobId, ownerId, reference) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function markStored(
  id: string,
  storageKey: string,
  storedSizeBytes: number,
  mimeType: string,
): void {
  getDb()
    .prepare(
      `UPDATE media_assets
          SET storage_key = ?, stored_size_bytes = ?, mime_type = ?, status = 'STORED'
        WHERE id = ?`,
    )
    .run(storageKey, storedSizeBytes, mimeType, id);
}

export function markRejected(id: string): void {
  getDb()
    .prepare(`UPDATE media_assets SET status = 'REJECTED' WHERE id = ?`)
    .run(id);
}

export interface MediaFindings {
  classification: MediaClassification | null;
  withheldReason: WithheldReason | null;
  description: string | null;
  extractedText: string | null;
  shape: MediaShape | null;
  transcriptStatus: TranscriptionStatus | null;
  transcriptText: string | null;
  transcriptLanguage: string | null;
}

export function recordFindings(id: string, findings: MediaFindings): void {
  getDb()
    .prepare(
      `UPDATE media_assets
          SET classification = ?, withheld_reason = ?, description = ?,
              extracted_text = ?, shape = ?, transcript_status = ?,
              transcript_text = ?, transcript_language = ?,
              status = 'PROCESSED', processed_at = ?
        WHERE id = ?`,
    )
    .run(
      findings.classification,
      findings.withheldReason,
      findings.description,
      findings.extractedText,
      findings.shape,
      findings.transcriptStatus,
      findings.transcriptText,
      findings.transcriptLanguage,
      nowIso(),
      id,
    );
}

/**
 * Forgets the bytes' location once the analysis is done with them.
 *
 * The findings stay - they are what the report cites. The pointer to the file
 * goes, because the file goes.
 */
export function clearStorageKeys(jobId: string): void {
  getDb()
    .prepare(`UPDATE media_assets SET storage_key = NULL WHERE job_id = ?`)
    .run(jobId);
}
