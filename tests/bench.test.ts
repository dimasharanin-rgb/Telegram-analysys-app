import { describe, expect, it } from "vitest";

import {
  SCENARIOS,
  SCENARIO_KINDS,
  scenarioCharacters,
  scenariosOfKind,
} from "@/lib/bench/scenarios";
import {
  STRATEGIES,
  STRATEGY_IDS,
  analysisShape,
  estimateStrategy,
} from "@/lib/bench/strategies";
import { resetServerConfigCache } from "@/lib/config";
import { tierOf, type AiTask } from "@/lib/ai/routing";

const MODULES: AiTask[] = [
  "COMMUNICATION",
  "INTERACTION",
  "TOPICS",
  "EMOTIONAL_LANGUAGE",
  "CONFLICT",
  "TIMELINE",
  "PERSONAL_PROFILES",
];

function shapes(options: { imageCount?: number; conversationTokens?: number } = {}) {
  return analysisShape({
    conversationTokens: options.conversationTokens ?? 8_000,
    imageCount: options.imageCount ?? 0,
    voiceCount: 0,
    modules: MODULES,
  });
}

function costOf(id: (typeof STRATEGY_IDS)[number], options = {}): number {
  resetServerConfigCache();
  return estimateStrategy(STRATEGIES[id], shapes(options)).costMicros;
}

describe("the evaluation set covers what it claims to", () => {
  it("has at least one scenario of every kind section 43 lists", () => {
    for (const kind of SCENARIO_KINDS) {
      expect(scenariosOfKind(kind).length).toBeGreaterThan(0);
    }
  });

  it("gives every scenario something concrete to be graded against", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.expectations.length).toBeGreaterThan(0);
      for (const expectation of scenario.expectations) {
        expect(expectation.length).toBeGreaterThan(20);
      }
    }
  });

  it("has unique ids, so results can be compared across runs", () => {
    const ids = SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes a conversation long enough to force a subset", () => {
    const longest = Math.max(...SCENARIOS.map((s) => s.turns.length));
    expect(longest).toBeGreaterThan(100);
  });

  it("exercises the gateway with media that must not be described", () => {
    const sensitive = scenariosOfKind("sensitive_media")[0]!;
    expect(sensitive.turns.some((turn) => turn.media === "image")).toBe(true);
    // The message keeps its words: that is the property being tested.
    expect(sensitive.turns[0]!.text.length).toBeGreaterThan(0);
  });

  it("measures a scenario in characters, which is what budgets are in", () => {
    expect(scenarioCharacters(SCENARIOS[0]!)).toBeGreaterThan(0);
  });
});

describe("the four strategies differ only in routing", () => {
  it("sends every task to the standard tier under sonnet-only", () => {
    for (const shape of shapes({ imageCount: 2 })) {
      expect(STRATEGIES["sonnet-only"].tierFor(shape.task)).toBe("standard");
    }
  });

  it("sends every task to the deep tier under opus-heavy", () => {
    for (const shape of shapes({ imageCount: 2 })) {
      expect(STRATEGIES["opus-heavy"].tierFor(shape.task)).toBe("deep");
    }
  });

  it("keeps media triage cheap but never escalates under cheap-then-sonnet", () => {
    const strategy = STRATEGIES["cheap-then-sonnet"];
    expect(strategy.tierFor("IMAGE_MODERATION")).toBe("cheap");
    expect(strategy.tierFor("RESPONSE_ADVICE")).toBe("standard");
    expect(strategy.escalationRate).toBe(0);
  });

  it("matches the shipped routing table under the strategy V3 uses", () => {
    const strategy = STRATEGIES["cheap-sonnet-selective-opus"];
    for (const task of ["IMAGE_MODERATION", "CONFLICT", "RESPONSE_ADVICE"] satisfies AiTask[]) {
      expect(strategy.tierFor(task)).toBe(tierOf(task));
    }
    expect(strategy.escalationRate).toBeGreaterThan(0);
  });
});

describe("what the cost comparison actually shows", () => {
  it("makes Opus-for-everything the most expensive by a wide margin", () => {
    const opus = costOf("opus-heavy", { imageCount: 4 });
    for (const id of STRATEGY_IDS) {
      if (id === "opus-heavy") continue;
      expect(costOf(id, { imageCount: 4 })).toBeLessThan(opus);
    }
  });

  it("costs less to move media triage to the cheap tier", () => {
    expect(costOf("cheap-then-sonnet", { imageCount: 8 })).toBeLessThan(
      costOf("sonnet-only", { imageCount: 8 }),
    );
  });

  it("saves nothing from the cheap tier when there is no media to triage", () => {
    // Worth knowing rather than assuming: with no attachments the cheap tier
    // has almost nothing to do, and the saving comes from Sonnet-over-Opus
    // instead. Routing earns its keep on media-heavy conversations.
    expect(costOf("cheap-then-sonnet", { imageCount: 0 })).toBe(
      costOf("sonnet-only", { imageCount: 0 }),
    );
  });

  it("charges for escalation rather than pretending it is free", () => {
    expect(costOf("cheap-sonnet-selective-opus")).toBeGreaterThan(
      costOf("cheap-then-sonnet"),
    );
  });

  it("still costs far less than Opus-for-everything once escalation is paid for", () => {
    const selective = costOf("cheap-sonnet-selective-opus", { imageCount: 4 });
    const opus = costOf("opus-heavy", { imageCount: 4 });
    expect(selective / opus).toBeLessThan(0.7);
  });

  it("counts every call, so tier totals match the task count", () => {
    resetServerConfigCache();
    const built = shapes({ imageCount: 3 });
    const estimate = estimateStrategy(STRATEGIES["cheap-then-sonnet"], built);
    const counted =
      estimate.callsByTier.cheap + estimate.callsByTier.standard + estimate.callsByTier.deep;
    expect(counted).toBe(built.length);
  });

  it("scales with the size of the conversation", () => {
    expect(costOf("cheap-then-sonnet", { conversationTokens: 40_000 })).toBeGreaterThan(
      costOf("cheap-then-sonnet", { conversationTokens: 4_000 }),
    );
  });
});
