import { z } from "zod";
import { AUTONOMOUS_RATINGS, type CandidateEvaluation } from "@/shared/types/autonomous";
import { DIRECTIONS } from "@/shared/types/trade";
import { toApiJsonSchema } from "@/ai/schema";

const rating = z.enum(AUTONOMOUS_RATINGS);
const price = z.number().refine(Number.isFinite, "must be finite").refine((v) => v > 0, "must be positive");
const list = z.array(z.string().min(1).max(400)).max(10);

/** The only shape accepted from the model for a candidate evaluation. */
export const candidateEvaluationSchema = z
  .object({
    decision: z.enum(["TRADE", "NO_TRADE"]),
    direction: z.enum(DIRECTIONS),
    setupQuality: z.number().int().min(0).max(100),
    trade: z.object({ entry: price, stopLoss: price, takeProfit: price }).strict().nullable(),
    riskAssessment: z
      .object({ riskDistance: z.number().refine(Number.isFinite), rewardDistance: z.number().refine(Number.isFinite), rr: z.number().refine(Number.isFinite) })
      .strict()
      .nullable(),
    technicalAssessment: z
      .object({
        trendAlignment: rating,
        marketStructure: rating,
        momentum: rating,
        entryQuality: rating,
        stopPlacement: rating,
        targetPlacement: rating,
      })
      .strict(),
    positiveFactors: list,
    warnings: list,
    contradictingFactors: list,
    invalidation: list,
    summary: z.string().min(1).max(1500),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === "TRADE" && !v.trade) ctx.addIssue({ code: "custom", path: ["trade"], message: "a TRADE decision needs entry, stopLoss and takeProfit" });
    if (v.decision === "NO_TRADE" && v.trade) ctx.addIssue({ code: "custom", path: ["trade"], message: "a NO_TRADE decision must not carry a trade" });
  }) satisfies z.ZodType<CandidateEvaluation>;

export const CANDIDATE_EVALUATION_JSON_SCHEMA = toApiJsonSchema(z.toJSONSchema(candidateEvaluationSchema)) as Record<string, unknown>;
