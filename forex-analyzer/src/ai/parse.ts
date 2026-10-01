import type { AiAssessment, ScoreComponent } from "@/shared/types/ai";
import { SCORE_COMPONENTS } from "@/shared/types/ai";
import { AiError } from "@/ai/errors";
import { aiAssessmentSchema } from "@/ai/schema";

export interface ParsedAssessment {
  assessment: AiAssessment;
  /** Adjustments or flags the app applied while validating. */
  notes: string[];
}

/** Wording that would present the score as a probability or the setup as certain. */
const CERTAINTY_PATTERNS: RegExp[] = [
  /\bguarantee(d|s)?\b/i,
  /\bhigh[- ]probability\b/i,
  /\b\d{1,3}(\.\d+)?\s?%\s+(chance|probability|likelihood)\b/i,
  /\b(probability|chance|likelihood) of (success|winning|profit)\b/i,
  /\b(risk[- ]free|can't lose|cannot lose|sure thing)\b/i,
];

function extractJson(raw: string): string {
  const text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced) return fenced[1]!;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new AiError("MALFORMED", "The AI response contained no JSON object.");
  return text.slice(start, end + 1);
}

function normaliseComponent(c: ScoreComponent): ScoreComponent {
  // A missing score means the model could not judge it; keep score and rating consistent.
  if (c.score === null && c.rating !== "UNKNOWN") return { ...c, rating: "UNKNOWN" };
  if (c.score !== null && c.rating === "UNKNOWN") return { ...c, score: null };
  return c;
}

/**
 * Validates the model's output against the strict schema. Free-form prose is
 * never interpreted: anything that is not exactly the expected JSON is a
 * MALFORMED error and the analysis is reported as unavailable.
 */
export function parseClaudeResponse(raw: string): ParsedAssessment {
  let data: unknown;
  try {
    data = JSON.parse(extractJson(raw));
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError("MALFORMED", "The AI response was not valid JSON.");
  }

  const result = aiAssessmentSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new AiError("MALFORMED", `The AI response did not match the required schema (${issues}).`);
  }

  const notes: string[] = [];
  const assessment: AiAssessment = { ...result.data, scoreBreakdown: { ...result.data.scoreBreakdown } };
  for (const key of SCORE_COMPONENTS) {
    const before = assessment.scoreBreakdown[key];
    const after = normaliseComponent(before);
    if (after !== before) {
      assessment.scoreBreakdown[key] = after;
      notes.push(`Score component "${key}" had an inconsistent score/rating and was marked UNKNOWN.`);
    }
  }

  const prose = [
    assessment.summary,
    ...assessment.warnings,
    ...assessment.positiveFactors,
    ...assessment.conflictingSignals,
    ...assessment.invalidation,
  ].join("\n");
  if (CERTAINTY_PATTERNS.some((p) => p.test(prose))) {
    notes.push("The AI text used certainty or probability language. Disregard it: the score is not a probability and no outcome is certain.");
  }

  return { assessment, notes };
}

