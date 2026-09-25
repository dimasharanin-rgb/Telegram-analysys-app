/**
 * Reusing an analysis instead of paying for it twice.
 *
 * The key is a hash of everything that would change the answer. That list is
 * the whole design: miss something out and the cache returns a stale result
 * with no way to notice, so the key is built explicitly and the test for it
 * enumerates each input.
 *
 * What is deliberately *not* in the key: the job id, the owner, the time. Two
 * runs of the same conversation with the same settings should hit, whoever
 * started them and whenever - that is the saving. Reads are still owner-scoped,
 * so a hit never crosses between accounts.
 */

import { createHash } from "node:crypto";

import { serverConfig } from "@/lib/config";
import { log } from "@/lib/logger";
import { getDb } from "@/server/db/client";
import { nowIso } from "@/server/ids";
import type { AnalysisResultV2 } from "@/lib/pipeline/modular";

/**
 * Bumped whenever a prompt or the result shape changes.
 *
 * Without it, editing a prompt would leave every existing cached result in
 * place and the change would appear to do nothing. It is a manual number on
 * purpose: hashing the prompt text would invalidate the cache on a typo fix in
 * a comment, and that is a lot of money to spend on a comment.
 */
export const ANALYSIS_PROMPT_VERSION = 3;

export interface CacheKeyInput {
  /** Hash of the messages the analysis will actually read. */
  conversationDigest: string;
  productId: string;
  /** Sorted by the caller; order must not change the key. */
  modules: readonly string[];
  language: string;
  /** Hash of the media findings, so re-running with media differs from without. */
  mediaDigest: string;
  sizeTierId: string;
}

/**
 * The cache key.
 *
 * Models are included through the tier configuration rather than by name, since
 * swapping the standard-tier model is exactly the case where a cached result
 * should not be reused.
 */
export function cacheKeyFor(input: CacheKeyInput): string {
  const models = serverConfig().anthropic.models;

  const parts = [
    `v${ANALYSIS_PROMPT_VERSION}`,
    input.conversationDigest,
    input.productId,
    [...input.modules].sort().join("+"),
    input.language,
    input.mediaDigest,
    input.sizeTierId,
    models.cheap,
    models.standard,
    models.deep,
  ];

  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

/**
 * A stable digest of what the model will read.
 *
 * Built from message ids and their text, so a conversation re-imported from the
 * same export produces the same digest while one extra message produces a
 * different one.
 */
export function digestExcerpts(
  excerpts: readonly { messages: readonly { id: string; t: string }[] }[],
): string {
  const hash = createHash("sha256");
  for (const excerpt of excerpts) {
    for (const message of excerpt.messages) {
      hash.update(message.id);
      hash.update("\u0000");
      hash.update(message.t);
      hash.update("\u0001");
    }
  }
  return hash.digest("hex").slice(0, 32);
}

/** A digest of the media findings, or a marker when there were none. */
export function digestMedia(
  findings: ReadonlyMap<string, readonly { description: string | null; extractedText: string | null }[]>,
  transcripts: ReadonlyMap<string, { text: string }>,
): string {
  if (findings.size === 0 && transcripts.size === 0) return "no-media";

  const hash = createHash("sha256");
  for (const key of [...findings.keys()].sort()) {
    hash.update(key);
    for (const item of findings.get(key) ?? []) {
      hash.update(item.description ?? "");
      hash.update(item.extractedText ?? "");
    }
  }
  for (const key of [...transcripts.keys()].sort()) {
    hash.update(key);
    hash.update(transcripts.get(key)?.text ?? "");
  }
  return hash.digest("hex").slice(0, 32);
}

/* -------------------------------------------------------------------------
 * Storage
 * ---------------------------------------------------------------------- */

interface Row {
  result_json: string;
  hit_count: number;
}

/**
 * Looks for a reusable result.
 *
 * Owner-scoped: an identical conversation analysed by two accounts is two cache
 * entries. Sharing them would be cheaper and would mean one person's analysis
 * being served from another's, which is not a trade worth making.
 */
export function findCachedResult(
  cacheKey: string,
  ownerId: string,
): AnalysisResultV2 | null {
  const row = getDb()
    .prepare<[string, string], Row>(
      `SELECT result_json, hit_count FROM analysis_cache
        WHERE cache_key = ? AND owner_id = ?`,
    )
    .get(cacheKey, ownerId);

  if (row === undefined) return null;

  getDb()
    .prepare(
      `UPDATE analysis_cache SET hit_count = hit_count + 1, last_used_at = ?
        WHERE cache_key = ? AND owner_id = ?`,
    )
    .run(nowIso(), cacheKey, ownerId);

  try {
    const parsed = JSON.parse(row.result_json) as AnalysisResultV2;
    log.info("analysis.cache_hit", { hits: row.hit_count + 1 });
    return parsed;
  } catch {
    // A row we cannot read is worse than no row: drop it rather than failing
    // every future run with the same key.
    deleteCachedResult(cacheKey, ownerId);
    return null;
  }
}

export function storeCachedResult(
  cacheKey: string,
  ownerId: string,
  jobId: string,
  result: AnalysisResultV2,
): void {
  const at = nowIso();
  getDb()
    .prepare(
      `INSERT INTO analysis_cache (cache_key, owner_id, job_id, result_json, created_at, last_used_at, hit_count)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(cache_key) DO UPDATE SET
         result_json = excluded.result_json,
         last_used_at = excluded.last_used_at`,
    )
    .run(cacheKey, ownerId, jobId, JSON.stringify(result), at, at);
}

export function deleteCachedResult(cacheKey: string, ownerId: string): void {
  getDb()
    .prepare(`DELETE FROM analysis_cache WHERE cache_key = ? AND owner_id = ?`)
    .run(cacheKey, ownerId);
}

/** Drops everything cached for one owner. Used when they ask to regenerate. */
export function clearOwnerCache(ownerId: string): number {
  const result = getDb()
    .prepare(`DELETE FROM analysis_cache WHERE owner_id = ?`)
    .run(ownerId);
  return result.changes;
}
