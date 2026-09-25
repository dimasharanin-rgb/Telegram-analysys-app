/**
 * The routing strategies a benchmark compares.
 *
 * §43 names four. They differ only in which tier each task runs on, which is
 * the point: the same pipeline, the same prompts, the same conversation, and
 * the only variable is the routing table. Anything else and the comparison
 * would not be measuring routing.
 *
 * The default estimate is deterministic and costs nothing, so the cost side of
 * the comparison can be answered without spending money. Quality cannot be, and
 * this is careful not to pretend otherwise: `--live` runs the models and the
 * expectations are graded separately.
 */

import { AI_TASKS, tierOf, type AiTask, type ModelTier } from "@/lib/ai/routing";
import { serverConfig } from "@/lib/config";

export const STRATEGY_IDS = [
  "sonnet-only",
  "cheap-then-sonnet",
  "cheap-sonnet-selective-opus",
  "opus-heavy",
] as const;

export type StrategyId = (typeof STRATEGY_IDS)[number];

export interface Strategy {
  id: StrategyId;
  name: string;
  description: string;
  /** Where a task runs under this strategy. */
  tierFor: (task: AiTask) => ModelTier;
  /** Share of eligible tasks that escalate a tier. 0 means none ever do. */
  escalationRate: number;
}

export const STRATEGIES: Record<StrategyId, Strategy> = {
  "sonnet-only": {
    id: "sonnet-only",
    name: "Sonnet only",
    description:
      "One model for everything, including image classification. The simplest thing that works, and the baseline the others have to beat.",
    tierFor: () => "standard",
    escalationRate: 0,
  },

  "cheap-then-sonnet": {
    id: "cheap-then-sonnet",
    name: "Cheap preprocessing, then Sonnet",
    description:
      "Media triage and per-chunk extraction on the cheap tier, analysis on the standard one. No escalation.",
    tierFor: (task) => (tierOf(task) === "deep" ? "standard" : tierOf(task)),
    escalationRate: 0,
  },

  "cheap-sonnet-selective-opus": {
    id: "cheap-sonnet-selective-opus",
    name: "Cheap, then Sonnet, then selective Opus",
    description:
      "What V3 ships. Escalates only a standard-tier result that came back low-confidence, self-contradictory or thin.",
    tierFor: (task) => tierOf(task),
    // Measured against the shipped escalation rule rather than assumed: the
    // figure is what makes the cost comparison honest, so it is a parameter
    // here and a recorded number in production.
    escalationRate: 0.15,
  },

  "opus-heavy": {
    id: "opus-heavy",
    name: "Opus for everything",
    description:
      "The V2 shape, kept as the upper bound. Every task on the deep tier, including classifying screenshots.",
    tierFor: () => "deep",
    escalationRate: 0,
  },
};

/* -------------------------------------------------------------------------
 * Estimating
 * ---------------------------------------------------------------------- */

/**
 * Rough token shape of one task.
 *
 * Deliberately crude and deliberately identical across strategies: the
 * comparison is about price per token, not about who writes shorter prompts.
 * Real figures come from the live run.
 */
export interface TaskShape {
  task: AiTask;
  inputTokens: number;
  outputTokens: number;
  /** Fraction of input served from cache, for the shared-context modules. */
  cachedFraction: number;
}

/**
 * The tasks one analysis runs, with their token shapes.
 *
 * Media tasks scale with the number of attachments, analysis modules with the
 * size of the conversation - so both are parameters rather than constants.
 */
export function analysisShape(options: {
  conversationTokens: number;
  imageCount: number;
  voiceCount: number;
  modules: readonly AiTask[];
}): TaskShape[] {
  const shapes: TaskShape[] = [];

  // Per image: one moderation call and, for the ones that survive triage, one
  // description. Images carry a fixed token cost regardless of the model.
  for (let i = 0; i < options.imageCount; i += 1) {
    shapes.push({ task: "IMAGE_MODERATION", inputTokens: 1_600, outputTokens: 60, cachedFraction: 0 });
    shapes.push({ task: "IMAGE_DESCRIBE", inputTokens: 1_600, outputTokens: 220, cachedFraction: 0 });
  }

  // Transcription is not a model call in this pipeline, so it contributes no
  // tokens here. Its cost lives in the media budget instead.

  for (const module of options.modules) {
    shapes.push({
      task: module,
      inputTokens: options.conversationTokens,
      outputTokens: 1_400,
      // Every module reads the same conversation prefix, so all but the first
      // are cache reads. That saving is identical across strategies, which is
      // why it has to be modelled rather than ignored.
      cachedFraction: 0.9,
    });
  }

  shapes.push({
    task: "SYNTHESIS",
    inputTokens: Math.round(options.conversationTokens * 0.3),
    outputTokens: 2_000,
    cachedFraction: 0.5,
  });

  return shapes;
}

export interface StrategyEstimate {
  strategy: StrategyId;
  costMicros: number;
  callsByTier: Record<ModelTier, number>;
  inputTokens: number;
  outputTokens: number;
}

/**
 * What one analysis would cost under one strategy.
 *
 * Prices come from configuration, so the comparison reflects this deployment's
 * actual rates rather than figures baked into a script.
 */
export function estimateStrategy(
  strategy: Strategy,
  shapes: readonly TaskShape[],
): StrategyEstimate {
  const prices = serverConfig().anthropic.tierPricing;
  const callsByTier: Record<ModelTier, number> = { cheap: 0, standard: 0, deep: 0 };

  let costMicros = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const shape of shapes) {
    const tier = strategy.tierFor(shape.task);
    callsByTier[tier] += 1;

    const cached = Math.round(shape.inputTokens * shape.cachedFraction);
    const fresh = shape.inputTokens - cached;
    const tierPrices = prices[tier];

    const micros =
      ((fresh * tierPrices.inputPerMTok +
        shape.outputTokens * tierPrices.outputPerMTok +
        cached * tierPrices.cacheReadPerMTok) /
        1_000_000) *
      1_000_000;

    costMicros += micros;
    inputTokens += shape.inputTokens;
    outputTokens += shape.outputTokens;

    // An escalated task is paid for twice: once at its own tier, once a tier up.
    if (strategy.escalationRate > 0 && tierOf(shape.task) === "standard") {
      const up = prices.deep;
      costMicros +=
        strategy.escalationRate *
        ((fresh * up.inputPerMTok +
          shape.outputTokens * up.outputPerMTok +
          cached * up.cacheReadPerMTok) /
          1_000_000) *
        1_000_000;
      callsByTier.deep += strategy.escalationRate;
    }
  }

  return {
    strategy: strategy.id,
    costMicros: Math.round(costMicros),
    callsByTier,
    inputTokens,
    outputTokens,
  };
}

/** Every task, for a sanity check that the strategies cover the same surface. */
export function allTasks(): readonly AiTask[] {
  return AI_TASKS;
}
