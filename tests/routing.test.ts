import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  AI_TASKS,
  MODEL_TIERS,
  costMicrosForTier,
  decideEscalation,
  nextTier,
  routeTask,
  tasksInTier,
  tierOf,
  type AiTask,
} from "@/lib/ai/routing";
import { resetServerConfigCache } from "@/lib/config";

const MODEL_ENV = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_MODEL_CHEAP",
  "ANTHROPIC_MODEL_STANDARD",
  "ANTHROPIC_MODEL_DEEP",
  "ANTHROPIC_TASK_MODELS",
  "ANTHROPIC_EFFORT_CHEAP",
];

afterEach(() => {
  for (const key of MODEL_ENV) delete process.env[key];
  resetServerConfigCache();
});

describe("every task has a routing decision", () => {
  it("assigns a tier to all of them", () => {
    for (const task of AI_TASKS) {
      expect(MODEL_TIERS).toContain(tierOf(task));
    }
  });

  it("puts media triage and preprocessing on the cheap tier", () => {
    const cheap = tasksInTier("cheap");
    expect(cheap).toContain("IMAGE_MODERATION");
    expect(cheap).toContain("IMAGE_DESCRIBE");
    expect(cheap).toContain("IMAGE_RELEVANCE");
    expect(cheap).toContain("SCREENSHOT_TEXT");
    expect(cheap).toContain("LANGUAGE_DETECT");
    expect(cheap).toContain("CHUNK_SUMMARY");
  });

  it("puts the analysis modules on the standard tier, not the deep one", () => {
    // The spec's rule: Sonnet is the default for serious analysis, Opus is
    // selective. Every batch module must therefore be standard.
    for (const task of [
      "COMMUNICATION",
      "INTERACTION",
      "TOPICS",
      "EMOTIONAL_LANGUAGE",
      "CONFLICT",
      "TIMELINE",
      "PERSONAL_PROFILES",
      "SYNTHESIS",
    ] satisfies AiTask[]) {
      expect(tierOf(task)).toBe("standard");
    }
  });

  it("reserves the deep tier for advice and explicit escalation", () => {
    expect(tasksInTier("deep").sort()).toEqual(
      ["AMBIGUITY", "AVOIDANCE_PATTERNS", "CONFLICT_DEEP", "RESPONSE_ADVICE", "SYNTHESIS_DEEP"],
    );
  });

  it("never routes a whole conversation analysis to the deep tier by default", () => {
    // Guards the "do NOT automatically send every conversation to Opus" rule:
    // nothing that runs once per analysis job may sit on the deep tier.
    const perJob = ["COMMUNICATION", "SYNTHESIS", "CHUNK_SUMMARY"] satisfies AiTask[];
    for (const task of perJob) expect(tierOf(task)).not.toBe("deep");
  });
});

describe("tiers resolve to configured models", () => {
  it("uses the documented defaults", () => {
    resetServerConfigCache();
    expect(routeTask("IMAGE_CLASSIFY").model).toBe("claude-haiku-4-5");
    expect(routeTask("COMMUNICATION").model).toBe("claude-sonnet-5");
    expect(routeTask("RESPONSE_ADVICE").model).toBe("claude-opus-5");
  });

  it("lets each tier be replaced without touching routing logic", () => {
    process.env.ANTHROPIC_MODEL_CHEAP = "some-cheap-model";
    process.env.ANTHROPIC_MODEL_STANDARD = "some-standard-model";
    process.env.ANTHROPIC_MODEL_DEEP = "some-deep-model";
    resetServerConfigCache();

    expect(routeTask("SCREENSHOT_TEXT").model).toBe("some-cheap-model");
    expect(routeTask("TIMELINE").model).toBe("some-standard-model");
    expect(routeTask("AMBIGUITY").model).toBe("some-deep-model");
  });

  it("treats the V2 single-model variable as the standard tier only", () => {
    // An existing deployment set ANTHROPIC_MODEL=claude-opus-5. Honouring it
    // for all three tiers would put every image classification back on Opus,
    // which is the exact cost problem V3 exists to fix.
    process.env.ANTHROPIC_MODEL = "claude-opus-5";
    resetServerConfigCache();

    expect(routeTask("COMMUNICATION").model).toBe("claude-opus-5");
    expect(routeTask("IMAGE_CLASSIFY").model).toBe("claude-haiku-4-5");
  });

  it("applies a per-task override over the tier's model", () => {
    process.env.ANTHROPIC_TASK_MODELS = "CONFLICT=claude-opus-5,IMAGE_DESCRIBE=tiny-vision";
    resetServerConfigCache();

    expect(routeTask("CONFLICT").model).toBe("claude-opus-5");
    expect(routeTask("IMAGE_DESCRIBE").model).toBe("tiny-vision");
    // Untouched tasks keep their tier's model.
    expect(routeTask("TIMELINE").model).toBe("claude-sonnet-5");
  });

  it("ignores a malformed override rather than refusing to start", () => {
    process.env.ANTHROPIC_TASK_MODELS = ",=nonsense,CONFLICT=,TIMELINE=fine-model,";
    resetServerConfigCache();

    expect(routeTask("TIMELINE").model).toBe("fine-model");
    expect(routeTask("CONFLICT").model).toBe("claude-sonnet-5");
  });

  it("gives the cheap tier a cheap effort by default", () => {
    resetServerConfigCache();
    expect(routeTask("IMAGE_CLASSIFY").effort).toBe("low");
    expect(routeTask("RESPONSE_ADVICE").effort).toBe("high");
  });
});

describe("escalation is deliberate, not automatic", () => {
  it("does nothing without an entitlement, however thin the result", () => {
    expect(
      decideEscalation({ lowConfidence: true, conflictingInterpretations: true }),
    ).toEqual({ escalate: false, reason: null });
  });

  it("escalates an entitled low-confidence result and says why", () => {
    expect(decideEscalation({ entitled: true, lowConfidence: true })).toEqual({
      escalate: true,
      reason: "low_confidence",
    });
  });

  it("reports the most serious reason when several apply", () => {
    expect(
      decideEscalation({
        entitled: true,
        thinResult: true,
        lowConfidence: true,
        conflictingInterpretations: true,
      }).reason,
    ).toBe("conflicting_interpretations");
  });

  it("stays put when nothing is wrong", () => {
    expect(decideEscalation({ entitled: true }).escalate).toBe(false);
  });

  it("raises a task one tier and records that it was raised", () => {
    resetServerConfigCache();
    const route = routeTask("CONFLICT", nextTier(tierOf("CONFLICT")));
    expect(route.tier).toBe("deep");
    expect(route.escalated).toBe(true);
    expect(routeTask("CONFLICT").escalated).toBe(false);
  });

  it("cannot escalate past the top tier", () => {
    expect(nextTier("deep")).toBe("deep");
  });
});

describe("cost is priced at the tier that actually ran", () => {
  const usage = { inputTokens: 100_000, outputTokens: 10_000 };

  it("makes a cheap call cheaper than a deep one", () => {
    resetServerConfigCache();
    expect(costMicrosForTier("cheap", usage)).toBeLessThan(
      costMicrosForTier("standard", usage),
    );
    expect(costMicrosForTier("standard", usage)).toBeLessThan(
      costMicrosForTier("deep", usage),
    );
  });

  it("charges cached input at the cache rate", () => {
    resetServerConfigCache();
    const cold = costMicrosForTier("standard", usage);
    const warm = costMicrosForTier("standard", { ...usage, cachedInputTokens: 90_000 });
    expect(warm).toBeLessThan(cold);
  });

  it("returns whole micros so totals stay exact", () => {
    resetServerConfigCache();
    const micros = costMicrosForTier("deep", { inputTokens: 3, outputTokens: 7 });
    expect(Number.isInteger(micros)).toBe(true);
  });
});

describe("model ids live in configuration only", () => {
  it("has no model id literal anywhere outside the config module", () => {
    // The spec's rule is "do NOT scatter model IDs throughout the
    // application". This is the only way to keep that true as the codebase
    // grows: a literal added in a route or a prompt fails this test.
    const hits = grepModelLiterals();
    expect(hits).toEqual([]);
  });
});

function grepModelLiterals(): string[] {
  let raw = "";
  try {
    raw = execFileSync(
      "grep",
      ["-rEn", "claude-(opus|sonnet|haiku|fable)-[0-9]", "src"],
      { encoding: "utf8" },
    );
  } catch {
    // grep exits 1 when nothing matched, which is the passing case.
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => !line.startsWith("src/lib/config.ts"));
}
