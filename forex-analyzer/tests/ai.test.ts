import { describe, expect, it } from "vitest";
import { AiError } from "@/ai/errors";
import { parseClaudeResponse } from "@/ai/parse";
import { AI_OUTPUT_JSON_SCHEMA, toApiJsonSchema } from "@/ai/schema";
import { validAssessment } from "./fixtures";

describe("parseClaudeResponse", () => {
  it("accepts JSON that matches the schema", () => {
    const { assessment, notes } = parseClaudeResponse(JSON.stringify(validAssessment()));
    expect(assessment.verdict).toBe("ACCEPTABLE");
    expect(assessment.setupQuality).toBe(74);
    expect(notes).toEqual([]);
  });

  it("tolerates a fenced code block around the JSON", () => {
    expect(parseClaudeResponse("```json\n" + JSON.stringify(validAssessment()) + "\n```").assessment.setupQuality).toBe(74);
  });

  it("rejects prose", () => {
    expect(() => parseClaudeResponse("This looks like a great trade, buy now!")).toThrow(AiError);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseClaudeResponse('{"verdict": "ACCEPTABLE", ')).toThrowError(/not valid JSON|no JSON/);
  });

  it("rejects verdicts outside ACCEPTABLE / CAUTION / REJECT", () => {
    for (const verdict of ["BUY", "SELL", "GUARANTEED", "HIGH PROBABILITY"]) {
      expect(() => parseClaudeResponse(JSON.stringify({ ...validAssessment(), verdict }))).toThrowError(/schema/);
    }
  });

  it("rejects out-of-range scores, missing fields and extra fields", () => {
    expect(() => parseClaudeResponse(JSON.stringify(validAssessment({ setupQuality: 140 })))).toThrow(AiError);
    const { summary: _omit, ...missing } = validAssessment();
    expect(() => parseClaudeResponse(JSON.stringify(missing))).toThrow(AiError);
    expect(() => parseClaudeResponse(JSON.stringify({ ...validAssessment(), winProbability: 0.74 }))).toThrow(AiError);
  });

  it("marks inconsistent score/rating pairs UNKNOWN instead of trusting them", () => {
    const a = validAssessment();
    a.scoreBreakdown.momentum = { score: 70, rating: "UNKNOWN", note: "n" };
    const { assessment, notes } = parseClaudeResponse(JSON.stringify(a));
    expect(assessment.scoreBreakdown.momentum.score).toBeNull();
    expect(notes[0]).toMatch(/momentum/);
  });

  it("flags probability or certainty language", () => {
    const { notes } = parseClaudeResponse(JSON.stringify(validAssessment({ summary: "This is a high-probability setup with a 74% chance of success." })));
    expect(notes.some((n) => /not a probability/.test(n))).toBe(true);
  });

  it("every MALFORMED error carries its code", () => {
    try {
      parseClaudeResponse("nope");
    } catch (e) {
      expect((e as AiError).code).toBe("MALFORMED");
    }
  });
});

describe("structured output schema", () => {
  const text = JSON.stringify(AI_OUTPUT_JSON_SCHEMA);

  it("keeps the verdict and rating enums so the API constrains them", () => {
    const props = (AI_OUTPUT_JSON_SCHEMA as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.verdict!.enum).toEqual(["ACCEPTABLE", "CAUTION", "REJECT"]);
  });

  it("drops constraints the API does not support and closes every object", () => {
    for (const k of ["minimum", "maximum", "maxLength", "minLength", "maxItems", "minItems", "$schema"]) expect(text).not.toContain(`"${k}"`);
    const objects = text.match(/"type":"object"/g)!.length;
    expect(text.match(/"additionalProperties":false/g)!.length).toBe(objects);
  });

  it("does not strip enum values that look like keywords", () => {
    expect(toApiJsonSchema({ type: "string", enum: ["minimum", "maximum"] })).toEqual({ type: "string", enum: ["minimum", "maximum"] });
  });
});
