import { describe, expect, it } from "vitest";

import {
  containsInternalId,
  dedupeStatements,
  DUPLICATE_THRESHOLD,
  statementSimilarity,
  stripFiller,
  stripInternalIds,
  tidyProse,
} from "@/lib/ai/prose";

describe("internal identifiers never reach the reader", () => {
  it("removes the exact leak seen in a real report", () => {
    const leaked =
      "She replies within a minute ([461273]-[461279], [493338]-[493345]) when the subject is the flat.";
    const cleaned = stripInternalIds(leaked);

    expect(cleaned).toBe("She replies within a minute when the subject is the flat.");
    expect(containsInternalId(cleaned)).toBe(false);
  });

  it("removes a single bracketed id without eating the sentence", () => {
    expect(stripInternalIds("You answered quickly [461273].")).toBe(
      "You answered quickly.",
    );
  });

  it("removes labelled id lists", () => {
    expect(stripInternalIds("The exchange (message ids 12-19) went unanswered.")).toBe(
      "The exchange went unanswered.",
    );
    expect(stripInternalIds("See ids: 4711, 4712 for the pattern.")).toBe(
      "See for the pattern.",
    );
  });

  it("leaves bracketed prose that is not an identifier alone", () => {
    const text = "He wrote “tomorow [sic]” and left it at that.";
    expect(stripInternalIds(text)).toBe(text);
  });

  it("leaves ordinary numbers and dates alone", () => {
    const text = "Median reply time is 7 minutes, up from 3 in March 2024.";
    expect(stripInternalIds(text)).toBe(text);
  });

  it("recognises a leak so a test or debug check can assert on it", () => {
    expect(containsInternalId("nothing here")).toBe(false);
    expect(containsInternalId("a citation [493338] here")).toBe(true);
  });
});

describe("filler removal", () => {
  it("drops a filler opener and re-capitalises what follows", () => {
    expect(
      stripFiller("It's important to note that you write longer messages at night."),
    ).toBe("You write longer messages at night.");
  });

  it("drops filler mid-paragraph too", () => {
    expect(
      stripFiller("Replies got shorter. Overall, the conversation demonstrates that both withdrew."),
    ).toBe("Replies got shorter. Both withdrew.");
  });

  it("leaves the same words alone inside a sentence", () => {
    const text = "The one pattern worth noting is the timing.";
    expect(stripFiller(text)).toBe(text);
  });
});

describe("tidyProse", () => {
  it("applies both treatments and normalises the wreckage", () => {
    expect(
      tidyProse("It is important to note that she replied fast ([461273], [461279])."),
    ).toBe("She replied fast.");
  });

  it("is a no-op on text that is already clean", () => {
    const text = "You send longer messages when discussing the move.";
    expect(tidyProse(text)).toBe(text);
  });
});

describe("near-duplicate findings", () => {
  it("scores rephrasings of one observation as similar", () => {
    const score = statementSimilarity(
      "You write longer messages during conflict",
      "Message length increases during conflict",
    );
    expect(score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it("scores unrelated observations as dissimilar", () => {
    const score = statementSimilarity(
      "You write longer messages during conflict",
      "Most conversations begin after 18:00",
    );
    expect(score).toBeLessThan(0.2);
  });

  it("keeps one of a duplicated pair, preferring the stronger", () => {
    const items = [
      { text: "You write longer messages during conflict", weight: 1 },
      { text: "Most conversations start in the evening", weight: 1 },
      { text: "You write longer messages during conflicts", weight: 5 },
    ];

    const kept = dedupeStatements(items, {
      statement: (item) => item.text,
      rank: (item) => item.weight,
    });

    expect(kept).toHaveLength(2);
    // The stronger version survives, in the earlier slot.
    expect(kept[0]!.weight).toBe(5);
    expect(kept[1]!.text).toContain("evening");
  });

  it("leaves a list with nothing in common untouched", () => {
    const items = [
      { text: "Replies slow down at weekends" },
      { text: "Questions mostly go unanswered" },
      { text: "The flat comes up every month" },
    ];
    expect(dedupeStatements(items, { statement: (i) => i.text })).toHaveLength(3);
  });
});
