import { z } from "zod";
import {
  AI_VERDICTS,
  DIRECTIONAL_BIASES,
  RATINGS,
  RISK_LEVELS,
  type AiAssessment,
} from "@/types/ai";

const rating = z.enum(RATINGS);
const score = z.number().int().min(0).max(100).nullable();
const note = z.string().max(400);
const list = z.array(z.string().min(1).max(400)).max(10);

const component = z.object({ score, rating, note }).strict();
const placement = z.object({ rating, note }).strict();

/**
 * The only shape accepted from the model. Anything that does not match is
 * treated as a failed analysis rather than being interpreted.
 */
export const aiAssessmentSchema = z
  .object({
    verdict: z.enum(AI_VERDICTS),
    setupQuality: z.number().int().min(0).max(100),
    directionalBias: z.enum(DIRECTIONAL_BIASES),
    technicalAssessment: z
      .object({
        score,
        trendAlignment: rating,
        momentum: rating,
        structure: rating,
        entryQuality: rating,
      })
      .strict(),
    riskAssessment: z
      .object({
        score,
        riskReward: z.number().nullable(),
        riskLevel: z.enum(RISK_LEVELS),
      })
      .strict(),
    scoreBreakdown: z
      .object({
        trendAlignment: component,
        marketStructure: component,
        momentum: component,
        entryQuality: component,
        riskReward: component,
        volatility: component,
        higherTimeframeAlignment: component,
      })
      .strict(),
    stopPlacement: placement,
    targetPlacement: placement,
    warnings: list,
    positiveFactors: list,
    conflictingSignals: list,
    invalidation: list.min(1),
    summary: z.string().min(1).max(1500),
  })
  .strict() satisfies z.ZodType<AiAssessment>;

/** Keywords the structured-output API does not support; they are enforced locally by the zod schema instead. */
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
]);

/** Removes unsupported constraints while keeping enums, required fields and closed objects. */
export function toApiJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toApiJsonSchema);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    out[key] = key === "enum" || key === "required" ? value : toApiJsonSchema(value);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

/**
 * JSON Schema sent to the API as the structured-output format, so the model's
 * reply is constrained to this shape (including the verdict and rating enums).
 * Numeric ranges and lengths are re-checked by parseClaudeResponse().
 */
export const AI_OUTPUT_JSON_SCHEMA = toApiJsonSchema(z.toJSONSchema(aiAssessmentSchema)) as Record<string, unknown>;
