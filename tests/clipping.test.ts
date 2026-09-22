import { describe, expect, it } from "vitest";

import {
  clipToBudget,
  describeCoverage,
  messageCost,
  partialDisclaimer,
  totalCost,
} from "@/lib/analysis/clipping";
import {
  DEFAULT_SIZE_TIER,
  getSizeTier,
  resolveSizeTier,
  sizeTierFor,
  sizeTiers,
} from "@/lib/analysis/size-tiers";
import { MessageType, type NormalizedMessage } from "@/lib/model/message";

function message(id: number, text: string): NormalizedMessage {
  const day = String((id % 27) + 1).padStart(2, "0");
  return {
    id: String(id),
    timestamp: `2024-03-${day}T12:00:00+00:00`,
    epochMs: Date.UTC(2024, 2, (id % 27) + 1, 12),
    localIso: `2024-03-${day}T12:00:00`,
    senderId: id % 2 === 0 ? "a" : "b",
    senderName: id % 2 === 0 ? "Alex" : "Sam",
    text,
    replyTo: null,
    type: MessageType.TEXT,
    hasMedia: false,
    media: [],
    reactions: [],
    edited: false,
    forwarded: false,
  };
}

/** Messages of a known, identical cost, for exact-boundary arithmetic. */
function uniform(count: number, textLength: number): NormalizedMessage[] {
  return Array.from({ length: count }, (_unused, index) =>
    message(index + 1, "x".repeat(textLength)),
  );
}

describe("size tiers are configuration", () => {
  it("offers the documented ladder", () => {
    expect(sizeTiers().map((tier) => [tier.id, tier.maxCharacters])).toEqual([
      ["standard", 30_000],
      ["extended", 60_000],
      ["large", 120_000],
      ["full", null],
    ]);
  });

  it("defaults to standard and falls back to it for anything unknown", () => {
    expect(resolveSizeTier(null).id).toBe(DEFAULT_SIZE_TIER);
    expect(resolveSizeTier("nonsense").id).toBe("standard");
    expect(getSizeTier("nonsense")).toBeNull();
  });

  it("gives a paid product more reading than the free one", () => {
    expect(sizeTierFor("free").maxCharacters).toBe(30_000);
    expect(sizeTierFor("deep-text").maxCharacters).toBe(60_000);
    // A product nobody mapped gets the default, not the largest.
    expect(sizeTierFor("invented-later").id).toBe("standard");
  });
});

describe("clipping never cuts a message in half", () => {
  it("returns everything when it fits", () => {
    const messages = uniform(10, 100);
    const result = clipToBudget(messages, 30_000);

    expect(result.messages).toHaveLength(10);
    expect(result.coverage.partial).toBe(false);
    expect(result.coverage.analysedCharacters).toBe(totalCost(messages));
  });

  it("stops before the message that would exceed the budget", () => {
    // Each message costs 100 + 16 = 116. A budget of 350 fits three (348).
    const messages = uniform(10, 100);
    const result = clipToBudget(messages, 350);

    expect(result.messages).toHaveLength(3);
    expect(result.coverage.analysedCharacters).toBe(348);
    expect(result.coverage.analysedCharacters).toBeLessThanOrEqual(350);
    expect(result.coverage.partial).toBe(true);
    // Every message that survived is whole.
    for (const kept of result.messages) expect(kept.text).toHaveLength(100);
  });

  it("takes the message that lands exactly on the boundary", () => {
    const messages = uniform(10, 100);
    // Exactly three messages' worth: the third must be included, not dropped.
    const result = clipToBudget(messages, 348);

    expect(result.messages).toHaveLength(3);
    expect(result.coverage.analysedCharacters).toBe(348);
  });

  it("still analyses one oversized message rather than nothing", () => {
    const messages = [message(1, "y".repeat(5_000)), message(2, "short")];
    const result = clipToBudget(messages, 100);

    expect(result.messages).toHaveLength(1);
    expect(result.coverage.partial).toBe(true);
    // Being slightly over is better than refusing to analyse anything.
    expect(result.coverage.analysedCharacters).toBeGreaterThan(100);
  });

  it("treats no budget as no limit", () => {
    const messages = uniform(1_000, 200);
    const result = clipToBudget(messages, null);

    expect(result.messages).toHaveLength(1_000);
    expect(result.coverage.partial).toBe(false);
    expect(result.coverage.budgetCharacters).toBeNull();
  });

  it("handles a conversation far larger than the budget", () => {
    const messages = uniform(20_000, 120);
    const result = clipToBudget(messages, 30_000);

    expect(result.coverage.totalMessages).toBe(20_000);
    expect(result.coverage.analysedMessages).toBeLessThan(250);
    expect(result.coverage.analysedCharacters).toBeLessThanOrEqual(30_000);
    expect(result.coverage.analysedThrough).not.toBeNull();
  });
});

describe("clipping counts characters, not bytes", () => {
  it("measures Cyrillic the same way it measures Latin", () => {
    const latin = message(1, "a".repeat(50));
    const cyrillic = message(2, "я".repeat(50));
    expect(messageCost(cyrillic)).toBe(messageCost(latin));
  });

  it("does not let a multi-byte script blow the budget", () => {
    // 100 Cyrillic characters cost the same as 100 Latin ones, so the same
    // budget fits the same number of messages in either language.
    const russian = Array.from({ length: 10 }, (_u, i) =>
      message(i + 1, "привет".repeat(17).slice(0, 100)),
    );
    const result = clipToBudget(russian, 350);
    expect(result.messages).toHaveLength(3);
  });

  it("keeps an emoji whole", () => {
    const messages = [message(1, "👍🏽 sounds good"), message(2, "ok")];
    const result = clipToBudget(messages, 10_000);
    expect(result.messages[0]!.text).toBe("👍🏽 sounds good");
  });

  it("handles mixed-language conversations", () => {
    const mixed = [
      message(1, "Привет, как дела?"),
      message(2, "Labdien, viss kārtībā"),
      message(3, "All good here"),
    ];
    const result = clipToBudget(mixed, 10_000);
    expect(result.messages).toHaveLength(3);
    expect(result.coverage.partial).toBe(false);
  });
});

describe("saying what was actually read", () => {
  it("states the whole figure when nothing was clipped", () => {
    const { coverage } = clipToBudget(uniform(5, 100), 30_000);
    expect(describeCoverage(coverage)).toBe("Analyzing all 580 characters");
    expect(partialDisclaimer(coverage)).toBeNull();
  });

  it("states both figures when it was", () => {
    const { coverage } = clipToBudget(uniform(10, 100), 350);
    expect(describeCoverage(coverage)).toBe("Analyzing 348 / 1,160 characters");
  });

  it("produces a disclaimer a reader can act on", () => {
    const { coverage } = clipToBudget(uniform(100, 100), 1_160);
    const disclaimer = partialDisclaimer(coverage)!;

    expect(disclaimer).toContain("10 of 100 messages");
    expect(disclaimer).toContain("%");
    expect(disclaimer).toContain("not read");
    // No internal identifiers, and a date the reader can locate.
    expect(disclaimer).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
