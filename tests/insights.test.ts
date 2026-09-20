import { describe, expect, it } from "vitest";

import { computeStatistics } from "@/lib/stats";
import { buildPseudonyms } from "@/lib/pipeline/payload";
import {
  buildInsightDeck,
  prioritiseDeck,
  PRIMARY_DECK_SIZE,
} from "@/lib/client/insights";
import type { Analysis } from "@/lib/ai/schema";
import { loadFixtureConversation } from "./helpers";

const ANALYSIS: Analysis = {
  overview: {
    summary: "Participant A writes more; Participant B replies faster.",
    confidence: "medium",
  },
  patterns: Array.from({ length: 6 }, (_, index) => ({
    title: `Pattern ${index} for Participant A`,
    category: "communication" as const,
    observation: "Participant A sends follow-ups.",
    interpretation: "One reading is impatience with silence.",
    uncertainty: "The messages cannot establish intent.",
    evidence: index % 2 === 0 ? [{ messageIds: ["2"], excerpt: "example" }] : [],
    confidence: (index === 0 ? "high" : index === 1 ? "low" : "medium") as
      | "high"
      | "medium"
      | "low",
  })),
  strengths: [
    { title: "Repair", description: "Both return to the subject.", evidence: [] },
  ],
  watchouts: [
    { title: "Deadlines", description: "Decisions arrive with time pressure.", evidence: [] },
  ],
  suggestions: [
    {
      title: "Separate the ask",
      description: "Split the decision from the deadline.",
      do: "State the need plainly.",
      avoid: "Adding external pressure.",
    },
  ],
  recurringTopics: [
    { topic: "the flat", description: "A possible move.", frequency: "monthly" },
  ],
};

function deck() {
  const conversation = loadFixtureConversation();
  const { statistics } = computeStatistics(conversation);
  return {
    conversation,
    cards: buildInsightDeck({
      statistics,
      analysis: ANALYSIS,
      pseudonyms: buildPseudonyms(conversation),
    }),
  };
}

describe("insight deck", () => {
  it("puts the real participant names back into the AI text", () => {
    const { conversation, cards } = deck();
    const first = conversation.participants[0]!.name;
    const overview = cards.find((card) => card.kind === "overview")!;
    expect(overview.body).toContain(first);
    expect(overview.body).not.toContain("Participant A");
  });

  it("marks measured cards separately from interpretation", () => {
    const { cards } = deck();
    const measured = cards.filter((card) => card.measured);
    expect(measured.length).toBeGreaterThanOrEqual(2);
    for (const card of measured) {
      expect(card.headline).toBeDefined();
      // A measured card never presents a model's reading as its own.
      expect(card.interpretation).toBeUndefined();
    }
  });

  it("splits observation, interpretation and uncertainty on AI patterns", () => {
    const { cards } = deck();
    const pattern = cards.find((card) => card.kind === "pattern")!;
    expect(pattern.observation).toBeTruthy();
    expect(pattern.interpretation).toBeTruthy();
    expect(pattern.uncertainty).toBeTruthy();
    expect(pattern.measured).toBe(false);
  });

  it("covers every section of the analysis", () => {
    const { cards } = deck();
    const kinds = new Set(cards.map((card) => card.kind));
    expect(kinds).toContain("overview");
    expect(kinds).toContain("measured");
    expect(kinds).toContain("pattern");
    expect(kinds).toContain("strength");
    expect(kinds).toContain("watchout");
    expect(kinds).toContain("suggestion");
    expect(kinds).toContain("topic");
  });
});

describe("deck prioritisation", () => {
  it("leads with the overview, then measured facts, then interpretation", () => {
    const { cards } = deck();
    const { primary } = prioritiseDeck(cards);
    expect(primary[0]!.kind).toBe("overview");
    expect(primary[1]!.kind).toBe("measured");
    const firstPattern = primary.findIndex((card) => card.kind === "pattern");
    const lastMeasured = primary.map((card) => card.kind).lastIndexOf("measured");
    expect(firstPattern).toBeGreaterThan(lastMeasured);
  });

  it("holds the first deck to a readable size and keeps the rest available", () => {
    const { cards } = deck();
    const { primary, extra } = prioritiseDeck(cards);
    expect(primary).toHaveLength(PRIMARY_DECK_SIZE);
    expect(primary.length + extra.length).toBe(cards.length);
  });

  it("ranks higher-confidence patterns first", () => {
    const { cards } = deck();
    const patterns = prioritiseDeck(cards)
      .primary.concat(prioritiseDeck(cards).extra)
      .filter((card) => card.kind === "pattern");
    expect(patterns[0]!.confidence).toBe("high");
    expect(patterns.at(-1)!.confidence).toBe("low");
  });
});
