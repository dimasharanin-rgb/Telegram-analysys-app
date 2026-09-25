/**
 * Which model does which job.
 *
 * V2 had one model and used it for everything, which meant a screenshot
 * classification cost the same per token as interpreting a breakup. V3 splits
 * the work into tiers and routes each task to the cheapest tier that can
 * actually do it:
 *
 *   Tier 0  deterministic code      no model at all (statistics, counting)
 *   Tier 1  cheap                   high volume, low judgement
 *   Tier 2  standard                serious contextual analysis - the default
 *   Tier 3  deep                    reasoning worth paying extra for
 *
 * Tier 0 is not represented here on purpose: a task that code can do has no
 * entry in this file, and that absence is the routing decision.
 *
 * Nothing here names a model. The tier-to-model mapping is configuration
 * (`ANTHROPIC_MODEL_CHEAP` / `_STANDARD` / `_DEEP`, with per-task overrides in
 * `ANTHROPIC_TASK_MODELS`), so models can be swapped without editing analysis
 * logic - which is the whole point of having this layer.
 */

import { serverConfig, type EffortLevel, type ModelTierConfig } from "@/lib/config";

export type ModelTier = keyof ModelTierConfig;

export const MODEL_TIERS: readonly ModelTier[] = ["cheap", "standard", "deep"] as const;

/**
 * Every task that reaches a model.
 *
 * Adding a task here forces a routing decision for it, which is the point:
 * a new analysis step cannot quietly default to the most expensive model.
 */
export const AI_TASKS = [
  // --- Tier 1: preprocessing and media triage -----------------------------
  "IMAGE_MODERATION",
  "IMAGE_CLASSIFY",
  "IMAGE_DESCRIBE",
  "IMAGE_RELEVANCE",
  "SCREENSHOT_TEXT",
  "LANGUAGE_DETECT",
  "TOPIC_CANDIDATES",
  "DIFFICULT_CANDIDATES",
  "CHUNK_SUMMARY",
  "MEDIA_TAG",
  "DOCUMENT_TRIAGE",

  // --- Tier 2: the analysis modules ---------------------------------------
  "COMMUNICATION",
  "INTERACTION",
  "TOPICS",
  "EMOTIONAL_LANGUAGE",
  "CONFLICT",
  "TIMELINE",
  "PERSONAL_PROFILES",
  "DOCUMENT_READ",
  "SYNTHESIS",

  // --- Tier 3: reserved for where the extra capability earns its price ----
  "CONFLICT_DEEP",
  "SYNTHESIS_DEEP",
  "AMBIGUITY",
  "RESPONSE_ADVICE",
  "AVOIDANCE_PATTERNS",
] as const;

export type AiTask = (typeof AI_TASKS)[number];

/**
 * The routing table.
 *
 * Explicit rather than inferred from the name, because a rule like "anything
 * ending in _DEEP is deep" is exactly the kind of thing that silently routes a
 * new task to Opus.
 */
const TASK_TIER: Record<AiTask, ModelTier> = {
  IMAGE_MODERATION: "cheap",
  IMAGE_CLASSIFY: "cheap",
  IMAGE_DESCRIBE: "cheap",
  IMAGE_RELEVANCE: "cheap",
  SCREENSHOT_TEXT: "cheap",
  LANGUAGE_DETECT: "cheap",
  TOPIC_CANDIDATES: "cheap",
  DIFFICULT_CANDIDATES: "cheap",
  CHUNK_SUMMARY: "cheap",
  MEDIA_TAG: "cheap",
  DOCUMENT_TRIAGE: "cheap",

  COMMUNICATION: "standard",
  INTERACTION: "standard",
  TOPICS: "standard",
  EMOTIONAL_LANGUAGE: "standard",
  CONFLICT: "standard",
  TIMELINE: "standard",
  PERSONAL_PROFILES: "standard",
  DOCUMENT_READ: "standard",
  SYNTHESIS: "standard",

  CONFLICT_DEEP: "deep",
  SYNTHESIS_DEEP: "deep",
  AMBIGUITY: "deep",
  // Advice is the one user-facing thing where a mediocre answer is worse than
  // no answer: it is what someone actually sends to another person. It is also
  // metered, so the cost is bounded by the allowance rather than by chat size.
  RESPONSE_ADVICE: "deep",
  AVOIDANCE_PATTERNS: "deep",
};

export function tierOf(task: AiTask): ModelTier {
  return TASK_TIER[task];
}

/** Every task routed to a given tier. Used by the benchmark harness. */
export function tasksInTier(tier: ModelTier): AiTask[] {
  return AI_TASKS.filter((task) => TASK_TIER[task] === tier);
}

export interface Route {
  task: AiTask;
  tier: ModelTier;
  model: string;
  effort: EffortLevel;
  /** True when the tier was raised above the task's default. */
  escalated: boolean;
}

/**
 * Resolves a task to a concrete model.
 *
 * `override` raises (or lowers) the tier for one call - escalation passes it.
 * A per-task model override in configuration wins over the tier's model, so a
 * single troublesome task can be moved without reshuffling the table.
 */
export function routeTask(task: AiTask, override?: ModelTier): Route {
  const config = serverConfig().anthropic;
  const defaultTier = TASK_TIER[task];
  const tier = override ?? defaultTier;
  const explicit = config.taskModels[task];

  return {
    task,
    tier,
    model: explicit ?? config.models[tier],
    effort: config.tierEffort[tier],
    escalated: tier !== defaultTier && tierRank(tier) > tierRank(defaultTier),
  };
}

export function tierRank(tier: ModelTier): number {
  return MODEL_TIERS.indexOf(tier);
}

/** The next tier up, or the same tier when already at the top. */
export function nextTier(tier: ModelTier): ModelTier {
  const next = MODEL_TIERS[tierRank(tier) + 1];
  return next ?? tier;
}

/* -------------------------------------------------------------------------
 * Escalation
 * ---------------------------------------------------------------------- */

/**
 * What makes a piece of analysis worth a second, more expensive look.
 *
 * These are read off the cheaper model's own output rather than guessed from
 * the conversation, so escalation is a response to a result that came back
 * thin - not a property of the chat that we could have charged for up front.
 */
export interface EscalationSignals {
  /** The model's own confidence, where the schema captured one. */
  lowConfidence?: boolean;
  /** Two findings that cannot both be true. */
  conflictingInterpretations?: boolean;
  /** The evidence supports more than one reading and the model said so. */
  ambiguousEvidence?: boolean;
  /** A section came back empty or close to it on a conversation that is not. */
  thinResult?: boolean;
  /** Set when the user paid for a tier that includes deeper reasoning. */
  entitled?: boolean;
}

export interface EscalationDecision {
  escalate: boolean;
  /** Short machine-readable reason, recorded with the call. */
  reason: string | null;
}

/**
 * Decides whether to re-run a task one tier up.
 *
 * Entitlement is a hard gate: without it, a thin result stays thin rather than
 * quietly spending an Opus call that nobody bought. With it, any one of the
 * quality signals is enough - a second opinion is cheap relative to shipping
 * an analysis whose own confidence was low.
 */
export function decideEscalation(signals: EscalationSignals): EscalationDecision {
  if (signals.entitled !== true) {
    return { escalate: false, reason: null };
  }
  if (signals.conflictingInterpretations === true) {
    return { escalate: true, reason: "conflicting_interpretations" };
  }
  if (signals.lowConfidence === true) {
    return { escalate: true, reason: "low_confidence" };
  }
  if (signals.ambiguousEvidence === true) {
    return { escalate: true, reason: "ambiguous_evidence" };
  }
  if (signals.thinResult === true) {
    return { escalate: true, reason: "thin_result" };
  }
  return { escalate: false, reason: null };
}

/* -------------------------------------------------------------------------
 * Cost
 * ---------------------------------------------------------------------- */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/**
 * What one call cost, in micro-dollars.
 *
 * Integer micros rather than floating-point dollars, so totals stay exact
 * however many calls a job makes. Priced per tier, because the entire point of
 * routing is that the tiers do not cost the same.
 */
export function costMicrosForTier(tier: ModelTier, usage: TokenUsage): number {
  const prices = serverConfig().anthropic.tierPricing[tier];
  const cached = usage.cachedInputTokens ?? 0;
  const freshInput = Math.max(0, usage.inputTokens - cached);

  const micros =
    (freshInput * prices.inputPerMTok +
      usage.outputTokens * prices.outputPerMTok +
      cached * prices.cacheReadPerMTok) /
    1_000_000;

  return Math.round(micros * 1_000_000);
}
