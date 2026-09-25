import { afterEach, describe, expect, it } from "vitest";

import {
  ANALYSIS_PROMPT_VERSION,
  cacheKeyFor,
  digestExcerpts,
  digestMedia,
  type CacheKeyInput,
} from "@/server/analysis/cache";
import { resetServerConfigCache } from "@/lib/config";

afterEach(() => {
  delete process.env.ANTHROPIC_MODEL_STANDARD;
  delete process.env.ANTHROPIC_MODEL_CHEAP;
  resetServerConfigCache();
});

function key(over: Partial<CacheKeyInput> = {}): string {
  resetServerConfigCache();
  return cacheKeyFor({
    conversationDigest: "abc123",
    productId: "free",
    modules: ["COMMUNICATION", "TIMELINE"],
    language: "en",
    mediaDigest: "no-media",
    sizeTierId: "standard",
    ...over,
  });
}

describe("the same analysis hits, a different one misses", () => {
  it("is stable for identical inputs", () => {
    expect(key()).toBe(key());
  });

  it("ignores the order modules were listed in", () => {
    // Otherwise the same analysis requested twice would miss depending on how
    // the checkboxes happened to be read.
    expect(key({ modules: ["TIMELINE", "COMMUNICATION"] })).toBe(
      key({ modules: ["COMMUNICATION", "TIMELINE"] }),
    );
  });

  it.each([
    ["the conversation", { conversationDigest: "different" }],
    ["the product", { productId: "deep-text" }],
    ["the module set", { modules: ["COMMUNICATION"] }],
    ["the analysis language", { language: "lv" }],
    ["the media findings", { mediaDigest: "something" }],
    ["the size tier", { sizeTierId: "large" }],
  ] satisfies [string, Partial<CacheKeyInput>][])(
    "changes when %s changes",
    (_label, change) => {
      expect(key(change)).not.toBe(key());
    },
  );

  it("changes when a tier's model is swapped", () => {
    const before = key();
    process.env.ANTHROPIC_MODEL_STANDARD = "some-other-model";
    resetServerConfigCache();
    expect(cacheKeyFor({
      conversationDigest: "abc123",
      productId: "free",
      modules: ["COMMUNICATION", "TIMELINE"],
      language: "en",
      mediaDigest: "no-media",
      sizeTierId: "standard",
    })).not.toBe(before);
  });

  it("changes when the cheap tier's model is swapped, not just the standard one", () => {
    const before = key();
    process.env.ANTHROPIC_MODEL_CHEAP = "another-cheap-model";
    resetServerConfigCache();
    expect(key()).not.toBe(before);
  });

  it("is versioned, so editing a prompt does not serve stale results", () => {
    expect(ANALYSIS_PROMPT_VERSION).toBeGreaterThan(0);
    // The version is part of the key: a bump has to change every key.
    const parts = { conversationDigest: "x", productId: "free", modules: [], language: "en", mediaDigest: "m", sizeTierId: "standard" };
    resetServerConfigCache();
    const withVersion = cacheKeyFor(parts);
    expect(withVersion).toHaveLength(64);
  });
});

describe("digesting what the model will read", () => {
  const excerpts = [
    { messages: [{ id: "1", t: "hello" }, { id: "2", t: "hi" }] },
  ];

  it("is stable for the same messages", () => {
    expect(digestExcerpts(excerpts)).toBe(digestExcerpts(excerpts));
  });

  it("changes when a message's text changes", () => {
    expect(
      digestExcerpts([{ messages: [{ id: "1", t: "hello" }, { id: "2", t: "hey" }] }]),
    ).not.toBe(digestExcerpts(excerpts));
  });

  it("changes when a message is added", () => {
    expect(
      digestExcerpts([
        { messages: [...excerpts[0]!.messages, { id: "3", t: "how are you" }] },
      ]),
    ).not.toBe(digestExcerpts(excerpts));
  });

  it("distinguishes the same text under a different id", () => {
    expect(
      digestExcerpts([{ messages: [{ id: "9", t: "hello" }, { id: "2", t: "hi" }] }]),
    ).not.toBe(digestExcerpts(excerpts));
  });
});

describe("digesting media findings", () => {
  const media = new Map([
    ["1", [{ description: "a plate of food", extractedText: null }]],
  ]);
  const transcripts = new Map([["2", { text: "sorry I'm late" }]]);

  it("marks the absence of media distinctly", () => {
    expect(digestMedia(new Map(), new Map())).toBe("no-media");
  });

  it("differs from no-media once anything was read", () => {
    expect(digestMedia(media, new Map())).not.toBe("no-media");
  });

  it("changes when a transcript changes", () => {
    const before = digestMedia(media, transcripts);
    const after = digestMedia(media, new Map([["2", { text: "sorry I am late" }]]));
    expect(after).not.toBe(before);
  });

  it("changes when a description changes", () => {
    const before = digestMedia(media, transcripts);
    const after = digestMedia(
      new Map([["1", [{ description: "a screenshot", extractedText: null }]]]),
      transcripts,
    );
    expect(after).not.toBe(before);
  });

  it("does not depend on map insertion order", () => {
    const one = digestMedia(
      new Map([["1", [{ description: "a", extractedText: null }]], ["2", [{ description: "b", extractedText: null }]]]),
      new Map(),
    );
    const two = digestMedia(
      new Map([["2", [{ description: "b", extractedText: null }]], ["1", [{ description: "a", extractedText: null }]]]),
      new Map(),
    );
    expect(one).toBe(two);
  });
});
