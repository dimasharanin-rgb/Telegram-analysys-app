import { describe, expect, it } from "vitest";

import { neighbourTexts, relevanceOf } from "@/server/media/relevance";
import { enrichExcerpts } from "@/lib/ai/media-context";
import { MediaClassification, WithheldReason } from "@/lib/media/classification";
import {
  MediaShape,
  TranscriptionStatus,
  type EventMedia,
  type Transcript,
} from "@/lib/model/event";
import { MessageType } from "@/lib/model/message";
import type { Excerpt } from "@/lib/ai/schema";

/* -------------------------------------------------------------------------
 * Relevance
 * ---------------------------------------------------------------------- */

describe("only images the conversation pointed at get read", () => {
  it("rates a directly referenced screenshot highest", () => {
    // Section 10's own example.
    const score = relevanceOf({
      text: "Here's the screenshot of what she said",
      neighbours: [],
    });
    expect(score.score).toBe(10);
    expect(score.reason).toBe("referred_to_directly");
  });

  it("rates a landscape photo beside small talk at nothing", () => {
    // The other half of section 10's example.
    const score = relevanceOf({ text: "nice weather today", neighbours: ["yeah"] });
    expect(score.score).toBe(0);
    expect(score.reason).toBe("nothing_pointed_at_it");
  });

  it("notices a reference in the surrounding messages", () => {
    const score = relevanceOf({ text: "", neighbours: ["look at this", "wow"] });
    expect(score.score).toBeGreaterThan(0);
  });

  it("recognises references in Latvian and Russian", () => {
    // An English-only phrase list would silently rate every non-English
    // conversation as irrelevant, which is most of the ones this was built for.
    expect(relevanceOf({ text: "paskaties šo", neighbours: [] }).score).toBe(10);
    expect(relevanceOf({ text: "посмотри вот это", neighbours: [] }).score).toBe(10);
  });

  it("treats an attachment sent without words as the message itself", () => {
    const score = relevanceOf({ text: "", neighbours: ["ok"] });
    expect(score.reason).toBe("sent_without_words");
  });

  it("rates an image near a question above one near nothing", () => {
    const nearQuestion = relevanceOf({ text: "is this the one?", neighbours: [] });
    const nearNothing = relevanceOf({ text: "ok fine", neighbours: [] });
    expect(nearQuestion.score).toBeGreaterThan(nearNothing.score);
  });

  it("discounts an image whose long caption already explains it", () => {
    const score = relevanceOf({ text: "x".repeat(200), neighbours: [] });
    expect(score.score).toBe(1);
    expect(score.reason).toBe("long_caption_already_explains");
  });
});

describe("reading a message's neighbours", () => {
  const ids = ["1", "2", "3", "4", "5"];
  const text = new Map([
    ["1", "first"],
    ["2", "second"],
    ["3", "third"],
    ["4", "fourth"],
    ["5", "fifth"],
  ]);

  it("takes messages either side, excluding the message itself", () => {
    expect(neighbourTexts(ids, text, "3")).toEqual(["first", "second", "fourth", "fifth"]);
  });

  it("copes at the edges", () => {
    expect(neighbourTexts(ids, text, "1")).toEqual(["second", "third"]);
    expect(neighbourTexts(ids, text, "5")).toEqual(["third", "fourth"]);
  });

  it("returns nothing for a message it cannot find", () => {
    expect(neighbourTexts(ids, text, "99")).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * Folding findings into the excerpts
 * ---------------------------------------------------------------------- */

function excerpt(messages: { id: string; t: string }[]): Excerpt {
  return {
    id: "e1",
    startIso: "2024-03-01T12:00:00",
    endIso: "2024-03-01T13:00:00",
    totalMessages: messages.length,
    messages: messages.map((message, index) => ({
      id: message.id,
      p: "P1",
      m: index,
      t: message.t,
    })),
  };
}

function media(over: Partial<EventMedia> = {}): EventMedia {
  return {
    kind: MessageType.IMAGE,
    classification: MediaClassification.ORDINARY,
    description: null,
    extractedText: null,
    shape: null,
    durationSeconds: null,
    withheld: null,
    label: "Image",
    ...over,
  };
}

function transcript(over: Partial<Transcript> = {}): Transcript {
  return {
    status: TranscriptionStatus.COMPLETED,
    text: "sorry, I got held up at work",
    language: "en",
    confidence: 0.9,
    detail: null,
    ...over,
  };
}

describe("what the pipeline learned reaches the model", () => {
  it("puts a transcript into the message the voice note was sent as", () => {
    const result = enrichExcerpts([excerpt([{ id: "1", t: "" }])], {
      media: new Map(),
      transcripts: new Map([["1", transcript()]]),
    });

    expect(result[0]!.messages[0]!.t).toContain("sorry, I got held up at work");
    expect(result[0]!.messages[0]!.t).toContain("transcribed");
  });

  it("keeps the caption and adds the screenshot's text after it", () => {
    const result = enrichExcerpts(
      [excerpt([{ id: "1", t: "here's the screenshot" }])],
      {
        media: new Map([
          [
            "1",
            [media({ extractedText: "you always disappear", shape: MediaShape.CHAT_SCREENSHOT })],
          ],
        ]),
        transcripts: new Map(),
      },
    );

    const text = result[0]!.messages[0]!.t;
    expect(text.startsWith("here's the screenshot")).toBe(true);
    expect(text).toContain("you always disappear");
  });

  it("says an image was attached even when nothing looked at it", () => {
    const result = enrichExcerpts([excerpt([{ id: "1", t: "look what I bought" }])], {
      media: new Map([
        [
          "1",
          [
            media({
              classification: MediaClassification.SEXUAL_EXPLICIT,
              withheld: WithheldReason.SENSITIVE_CONTENT,
            }),
          ],
        ],
      ]),
      transcripts: new Map(),
    });

    const text = result[0]!.messages[0]!.t;
    expect(text).toContain("look what I bought");
    expect(text).toContain("not analyzed");
    expect(text).not.toContain("SEXUAL");
  });

  it("leaves messages with no media exactly as they were", () => {
    const original = [excerpt([{ id: "1", t: "hello" }, { id: "2", t: "hi" }])];
    const result = enrichExcerpts(original, {
      media: new Map([["1", [media({ description: "a cat" })]]]),
      transcripts: new Map(),
    });
    expect(result[0]!.messages[1]!.t).toBe("hi");
  });

  it("returns the excerpts untouched when there is no media at all", () => {
    const original = [excerpt([{ id: "1", t: "hello" }])];
    const result = enrichExcerpts(original, {
      media: new Map(),
      transcripts: new Map(),
    });
    expect(result).toBe(original);
  });

  it("does not mutate the stored excerpts", () => {
    const original = [excerpt([{ id: "1", t: "hello" }])];
    enrichExcerpts(original, {
      media: new Map([["1", [media({ description: "a cat" })]]]),
      transcripts: new Map(),
    });
    // The job input keeps the text-only version, so a re-run under different
    // media settings starts from the same place.
    expect(original[0]!.messages[0]!.t).toBe("hello");
  });

  it("truncates rather than exceeding the excerpt's own limit", () => {
    const result = enrichExcerpts([excerpt([{ id: "1", t: "a".repeat(1_500) }])], {
      media: new Map(),
      transcripts: new Map([["1", transcript({ text: "b".repeat(1_500) })]]),
    });
    expect(result[0]!.messages[0]!.t.length).toBeLessThanOrEqual(2_000);
  });

  it("never puts an internal identifier into the text", () => {
    const result = enrichExcerpts([excerpt([{ id: "461273", t: "hey" }])], {
      media: new Map([["461273", [media({ description: "a plate of food" })]]]),
      transcripts: new Map(),
    });
    expect(result[0]!.messages[0]!.t).not.toContain("461273");
  });
});
