import type { CandidateEvaluation } from "@/shared/types/autonomous";
import { AiError } from "@/ai/errors";
import { candidateEvaluationSchema } from "./schema";

const CERTAINTY = [/\bguarantee(d|s)?\b/i, /\bhigh[- ]probability\b/i, /\b\d{1,3}(\.\d+)?\s?%\s+(chance|probability|likelihood)\b/i, /\b(probability|chance|likelihood) of (success|winning|profit)\b/i, /\b(risk[- ]free|sure thing|safe trade|almost certain)\b/i];

/**
 * Strict validation of the model's answer: JSON extraction, schema, enums,
 * numeric ranges, required fields. Anything else throws MALFORMED, which the
 * service turns into a safe NO_TRADE.
 */
export function parseCandidateEvaluation(raw: string): { evaluation: CandidateEvaluation; notes: string[] } {
  const text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  const body = fenced ? fenced[1]! : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new AiError("MALFORMED", "The AI response was not valid JSON.");
  }
  const result = candidateEvaluationSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new AiError("MALFORMED", `The AI response did not match the required schema (${issues}).`);
  }
  const e = result.data;
  const prose = [e.summary, ...e.positiveFactors, ...e.warnings, ...e.contradictingFactors, ...e.invalidation].join("\n");
  const notes = CERTAINTY.some((r) => r.test(prose)) ? ["The AI text used certainty or probability language; the setup quality is not a probability."] : [];
  return { evaluation: e, notes };
}
