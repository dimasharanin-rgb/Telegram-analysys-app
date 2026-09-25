/**
 * Analysis jobs, their input payload, their result and their AI usage.
 *
 * The input payload is the only place message text reaches the database. It is
 * held because consent and payment are asynchronous - the browser tab cannot
 * be the source of truth while someone else decides - and it is pruned to the
 * cited evidence as soon as the analysis completes.
 */

import { assertTransition, type JobStage, type JobStatus } from "@/lib/analysis/job";
import { getDb } from "@/server/db/client";
import { newId, nowIso } from "@/server/ids";

export interface AnalysisJobRecord {
  id: string;
  ownerId: string;
  conversationId: string;
  productId: string;
  analysisType: string;
  modules: string[];
  contentTypes: string[];
  depth: string;
  status: JobStatus;
  progress: number;
  stage: JobStage | null;
  stageMessage: string | null;
  entitlementId: string | null;
  inputMessageCount: number;
  inputExcerptChars: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  estimatedCostMicros: number;
  actualCostMicros: number;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface JobRow {
  id: string;
  owner_id: string;
  conversation_id: string;
  product_id: string;
  analysis_type: string;
  modules: string;
  content_types: string;
  depth: string;
  status: string;
  progress: number;
  stage: string | null;
  stage_message: string | null;
  entitlement_id: string | null;
  input_message_count: number;
  input_excerpt_chars: number;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
  estimated_cost_micros: number;
  actual_cost_micros: number;
  error_code: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function toJob(row: JobRow): AnalysisJobRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    conversationId: row.conversation_id,
    productId: row.product_id,
    analysisType: row.analysis_type,
    modules: JSON.parse(row.modules) as string[],
    contentTypes: JSON.parse(row.content_types) as string[],
    depth: row.depth,
    status: row.status as JobStatus,
    progress: row.progress,
    stage: row.stage as JobStage | null,
    stageMessage: row.stage_message,
    entitlementId: row.entitlement_id,
    inputMessageCount: row.input_message_count,
    inputExcerptChars: row.input_excerpt_chars,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    requestCount: row.request_count,
    estimatedCostMicros: row.estimated_cost_micros,
    actualCostMicros: row.actual_cost_micros,
    errorCode: row.error_code,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export interface CreateJobInput {
  ownerId: string;
  conversationId: string;
  productId: string;
  analysisType: string;
  modules: string[];
  contentTypes: string[];
  depth: string;
  status: JobStatus;
  inputMessageCount: number;
  inputExcerptChars: number;
  estimatedCostMicros: number;
}

export function createJob(input: CreateJobInput): AnalysisJobRecord {
  const id = newId("job");
  getDb()
    .prepare(
      `INSERT INTO analysis_jobs
         (id, owner_id, conversation_id, product_id, analysis_type, modules,
          content_types, depth, status, input_message_count,
          input_excerpt_chars, estimated_cost_micros, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.ownerId,
      input.conversationId,
      input.productId,
      input.analysisType,
      JSON.stringify(input.modules),
      JSON.stringify(input.contentTypes),
      input.depth,
      input.status,
      input.inputMessageCount,
      input.inputExcerptChars,
      input.estimatedCostMicros,
      nowIso(),
    );
  return getJobById(id)!;
}

function getJobById(id: string): AnalysisJobRecord | null {
  const row = getDb()
    .prepare<[string], JobRow>("SELECT * FROM analysis_jobs WHERE id = ?")
    .get(id);
  return row ? toJob(row) : null;
}

/** Ownership is part of the query, so another owner's id simply misses. */
export function getJob(id: string, ownerId: string): AnalysisJobRecord | null {
  const row = getDb()
    .prepare<[string, string], JobRow>(
      "SELECT * FROM analysis_jobs WHERE id = ? AND owner_id = ?",
    )
    .get(id, ownerId);
  return row ? toJob(row) : null;
}

export function listJobs(ownerId: string, limit = 50): AnalysisJobRecord[] {
  return getDb()
    .prepare<[string, number], JobRow>(
      "SELECT * FROM analysis_jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(ownerId, limit)
    .map(toJob);
}

export function listJobsForConversation(conversationId: string): AnalysisJobRecord[] {
  return getDb()
    .prepare<[string], JobRow>(
      "SELECT * FROM analysis_jobs WHERE conversation_id = ? ORDER BY created_at DESC",
    )
    .all(conversationId)
    .map(toJob);
}

export interface TransitionPatch {
  entitlementId?: string | null;
  model?: string | null;
  errorCode?: string | null;
}

/**
 * Moves a job to a new status. Illegal transitions throw rather than silently
 * writing a state the rest of the system does not expect.
 */
export function transitionJob(
  id: string,
  to: JobStatus,
  patch: TransitionPatch = {},
): AnalysisJobRecord {
  const current = getJobById(id);
  if (!current) throw new Error(`Unknown analysis job ${id}`);
  assertTransition(current.status, to);

  const at = nowIso();
  const sets = ["status = ?"];
  const values: (string | number | null)[] = [to];

  if (to === "PROCESSING" && current.startedAt === null) {
    sets.push("started_at = ?");
    values.push(at);
  }
  if (to === "COMPLETED" || to === "FAILED" || to === "CANCELLED") {
    sets.push("completed_at = ?");
    values.push(at);
  }
  if (patch.entitlementId !== undefined) {
    sets.push("entitlement_id = ?");
    values.push(patch.entitlementId);
  }
  if (patch.model !== undefined) {
    sets.push("model = ?");
    values.push(patch.model);
  }
  if (patch.errorCode !== undefined) {
    sets.push("error_code = ?");
    values.push(patch.errorCode);
  }

  values.push(id);
  getDb()
    .prepare(`UPDATE analysis_jobs SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);

  return getJobById(id)!;
}

export function updateProgress(
  id: string,
  stage: JobStage,
  message: string,
  percent: number,
): void {
  getDb()
    .prepare(
      "UPDATE analysis_jobs SET stage = ?, stage_message = ?, progress = ? WHERE id = ?",
    )
    .run(stage, message, Math.max(0, Math.min(100, Math.round(percent))), id);
}

/* -------------------------------------------------------------------------
 * Input payload
 * ---------------------------------------------------------------------- */

export function saveJobInput(jobId: string, payload: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO analysis_inputs (job_id, payload, created_at) VALUES (?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET payload = excluded.payload, pruned = 0, pruned_at = NULL`,
    )
    .run(jobId, JSON.stringify(payload), nowIso());
}

export interface StoredJobInput {
  payload: unknown;
  pruned: boolean;
}

export function getJobInput(jobId: string): StoredJobInput | null {
  const row = getDb()
    .prepare<[string], { payload: string; pruned: number }>(
      "SELECT payload, pruned FROM analysis_inputs WHERE job_id = ?",
    )
    .get(jobId);
  if (!row) return null;
  return { payload: JSON.parse(row.payload) as unknown, pruned: row.pruned === 1 };
}

/** Replaces the stored payload with a reduced one and marks it pruned. */
export function pruneJobInput(jobId: string, reduced: unknown): void {
  getDb()
    .prepare(
      "UPDATE analysis_inputs SET payload = ?, pruned = 1, pruned_at = ? WHERE job_id = ?",
    )
    .run(JSON.stringify(reduced), nowIso(), jobId);
}

export function deleteJobInput(jobId: string): void {
  getDb().prepare("DELETE FROM analysis_inputs WHERE job_id = ?").run(jobId);
}

/* -------------------------------------------------------------------------
 * Result and usage
 * ---------------------------------------------------------------------- */

export function saveJobResult(jobId: string, result: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO analysis_results (job_id, result, created_at) VALUES (?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET result = excluded.result`,
    )
    .run(jobId, JSON.stringify(result), nowIso());
}

export function getJobResult(jobId: string): unknown | null {
  const row = getDb()
    .prepare<[string], { result: string }>(
      "SELECT result FROM analysis_results WHERE job_id = ?",
    )
    .get(jobId);
  return row ? (JSON.parse(row.result) as unknown) : null;
}

/**
 * One model call, as recorded.
 *
 * Wider than V2's four numbers because routing cannot be tuned without knowing
 * which tier ran, what it cost, how long it took and whether it had to be
 * repaired or escalated. None of this is user-facing: it exists so the routing
 * table can be judged against real traffic instead of guesses.
 */
export interface UsageInput {
  jobId: string;
  ownerId: string;
  module: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  /** The routing task and tier. Empty only for a call made before routing. */
  task?: string;
  tier?: string;
  provider?: string;
  cachedInputTokens?: number;
  latencyMs?: number;
  retries?: number;
  cached?: boolean;
  escalated?: boolean;
  ok?: boolean;
  /** Set for a call whose input was an attachment, so media cost is separable. */
  mediaKind?: string | null;
}

/** Records one model call and rolls the totals up onto the job. */
export function recordUsage(input: UsageInput): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO usage_records
         (id, job_id, owner_id, module, model, input_tokens, output_tokens,
          cost_micros, at, task, tier, provider, cached_input_tokens,
          latency_ms, retries, cached, escalated, ok, media_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId("use"),
      input.jobId,
      input.ownerId,
      input.module,
      input.model,
      input.inputTokens,
      input.outputTokens,
      input.costMicros,
      nowIso(),
      input.task ?? "",
      input.tier ?? "",
      input.provider ?? "",
      input.cachedInputTokens ?? 0,
      input.latencyMs ?? 0,
      input.retries ?? 0,
      input.cached === true ? 1 : 0,
      input.escalated === true ? 1 : 0,
      input.ok === false ? 0 : 1,
      input.mediaKind ?? null,
    );
    db.prepare(
      `UPDATE analysis_jobs
          SET input_tokens = input_tokens + ?,
              output_tokens = output_tokens + ?,
              request_count = request_count + 1,
              actual_cost_micros = actual_cost_micros + ?,
              model = ?
        WHERE id = ?`,
    ).run(input.inputTokens, input.outputTokens, input.costMicros, input.model, input.jobId);
  })();
}

export interface UsageRecord {
  module: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  at: string;
  task: string;
  tier: string;
  provider: string;
  cachedInputTokens: number;
  latencyMs: number;
  retries: number;
  cached: boolean;
  escalated: boolean;
  ok: boolean;
}

interface UsageRow {
  module: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  at: string;
  task: string;
  tier: string;
  provider: string;
  cached_input_tokens: number;
  latency_ms: number;
  retries: number;
  cached: number;
  escalated: number;
  ok: number;
}

export function listUsage(jobId: string): UsageRecord[] {
  return getDb()
    .prepare<[string], UsageRow>(
      `SELECT module, model, input_tokens, output_tokens, cost_micros, at, task,
              tier, provider, cached_input_tokens, latency_ms, retries, cached,
              escalated, ok
         FROM usage_records WHERE job_id = ? ORDER BY at ASC`,
    )
    .all(jobId)
    .map((row) => ({
      module: row.module,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costMicros: row.cost_micros,
      at: row.at,
      task: row.task,
      tier: row.tier,
      provider: row.provider,
      cachedInputTokens: row.cached_input_tokens,
      latencyMs: row.latency_ms,
      retries: row.retries,
      cached: row.cached === 1,
      escalated: row.escalated === 1,
      ok: row.ok === 1,
    }));
}

/**
 * What one analysis spent, by tier.
 *
 * The figure that says whether routing is working: if the standard tier is
 * carrying calls the cheap tier could have done, it shows up here as cost
 * concentrated in the wrong row.
 */
export interface TierSpend {
  tier: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  cachedCalls: number;
  escalatedCalls: number;
  failedCalls: number;
  medianLatencyMs: number;
}

export function spendByTier(jobId: string): TierSpend[] {
  const records = listUsage(jobId);
  const byTier = new Map<string, UsageRecord[]>();

  for (const record of records) {
    const key = record.tier || "unrouted";
    const list = byTier.get(key) ?? [];
    list.push(record);
    byTier.set(key, list);
  }

  return [...byTier.entries()]
    .map(([tier, list]) => {
      const latencies = list.map((r) => r.latencyMs).sort((a, b) => a - b);
      return {
        tier,
        calls: list.length,
        inputTokens: list.reduce((sum, r) => sum + r.inputTokens, 0),
        outputTokens: list.reduce((sum, r) => sum + r.outputTokens, 0),
        costMicros: list.reduce((sum, r) => sum + r.costMicros, 0),
        cachedCalls: list.filter((r) => r.cached).length,
        escalatedCalls: list.filter((r) => r.escalated).length,
        failedCalls: list.filter((r) => !r.ok).length,
        // Median rather than mean: one 90-second call should not make every
        // other call in the tier look slow.
        medianLatencyMs: latencies[Math.floor(latencies.length / 2)] ?? 0,
      };
    })
    .sort((a, b) => b.costMicros - a.costMicros);
}

export function deleteJob(id: string, ownerId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM analysis_jobs WHERE id = ? AND owner_id = ?")
    .run(id, ownerId);
  return result.changes > 0;
}
