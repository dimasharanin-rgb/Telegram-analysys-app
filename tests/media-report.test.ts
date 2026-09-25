import { describe, expect, it } from "vitest";

import { summariseMedia } from "@/server/analysis/process-media-summary";
import { MediaClassification, WithheldReason, publicMediaLabel } from "@/lib/media/classification";
import { TranscriptionStatus, type EventMedia, type Transcript } from "@/lib/model/event";
import { MessageType } from "@/lib/model/message";
import type { MediaOutcome } from "@/server/media/process";

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

function outcome(over: Partial<MediaOutcome> = {}): MediaOutcome {
  return {
    media: new Map(),
    transcripts: new Map(),
    summary: { considered: 0, described: 0, transcribed: 0, withheld: 0, failed: 0 },
    ...over,
  };
}

const CONTEXT = {
  timeById: new Map([
    ["1", "2024-03-01T12:00:00.000Z"],
    ["2", "2024-03-05T09:00:00.000Z"],
    ["3", "2024-02-01T09:00:00.000Z"],
  ]),
  participantById: new Map([
    ["1", "P1"],
    ["2", "P2"],
    ["3", "P1"],
  ]),
};

describe("the report's media section", () => {
  it("is absent when the conversation had no attachments", () => {
    expect(summariseMedia(outcome(), CONTEXT)).toBeNull();
  });

  it("carries the counts through unchanged", () => {
    const summary = summariseMedia(
      outcome({
        media: new Map([["1", [media({ description: "a plate of food" })]]]),
        summary: { considered: 4, described: 1, transcribed: 2, withheld: 1, failed: 0 },
      }),
      CONTEXT,
    )!;

    expect(summary.considered).toBe(4);
    expect(summary.described).toBe(1);
    expect(summary.transcribed).toBe(2);
    expect(summary.withheld).toBe(1);
  });

  it("orders attachments by when they were sent", () => {
    const summary = summariseMedia(
      outcome({
        media: new Map([
          ["1", [media()]],
          ["2", [media()]],
          ["3", [media()]],
        ]),
        summary: { considered: 3, described: 0, transcribed: 0, withheld: 3, failed: 0 },
      }),
      CONTEXT,
    )!;

    const times = summary.items.map((item) => item.at);
    expect(times).toEqual([...times].sort());
  });

  it("shows a transcript as the attachment's detail", () => {
    const transcript: Transcript = {
      status: TranscriptionStatus.COMPLETED,
      text: "sorry, I got held up at work",
      language: "en",
      confidence: 0.9,
      detail: null,
    };
    const summary = summariseMedia(
      outcome({
        media: new Map([["1", [media({ kind: MessageType.AUDIO, label: "Voice message — transcript available" })]]]),
        transcripts: new Map([["1", transcript]]),
        summary: { considered: 1, described: 0, transcribed: 1, withheld: 0, failed: 0 },
      }),
      CONTEXT,
    )!;

    expect(summary.items[0]!.detail).toBe("sorry, I got held up at work");
  });

  it("prefers a screenshot's own text over a model's description of it", () => {
    const summary = summariseMedia(
      outcome({
        media: new Map([
          [
            "1",
            [
              media({
                description: "a screenshot of a messaging app",
                extractedText: "you always disappear when it matters",
              }),
            ],
          ],
        ]),
        summary: { considered: 1, described: 1, transcribed: 0, withheld: 0, failed: 0 },
      }),
      CONTEXT,
    )!;

    // The participants' own words are evidence; a paraphrase is not.
    expect(summary.items[0]!.detail).toBe("you always disappear when it matters");
  });

  it("gives a withheld attachment a line with no detail at all", () => {
    const summary = summariseMedia(
      outcome({
        media: new Map([
          [
            "1",
            [
              media({
                classification: MediaClassification.SEXUAL_EXPLICIT,
                withheld: WithheldReason.SENSITIVE_CONTENT,
                label: publicMediaLabel("image", WithheldReason.SENSITIVE_CONTENT),
              }),
            ],
          ],
        ]),
        summary: { considered: 1, described: 0, transcribed: 0, withheld: 1, failed: 0 },
      }),
      CONTEXT,
    )!;

    const item = summary.items[0]!;
    // It existed, by whom and when. Nothing about what was in it.
    expect(item.label).toBe("Private image — not analyzed");
    expect(item.detail).toBeNull();
    expect(item.participant).toBe("P1");
  });

  it("leaks no classification name into anything a reader sees", () => {
    const summary = summariseMedia(
      outcome({
        media: new Map(
          Object.values(MediaClassification).map((classification, index) => [
            String((index % 3) + 1),
            [
              media({
                classification,
                withheld: WithheldReason.SENSITIVE_CONTENT,
                label: publicMediaLabel("image", WithheldReason.SENSITIVE_CONTENT),
              }),
            ],
          ]),
        ),
        summary: { considered: 9, described: 0, transcribed: 0, withheld: 9, failed: 0 },
      }),
      CONTEXT,
    )!;

    const rendered = JSON.stringify(summary);
    for (const name of Object.values(MediaClassification)) {
      expect(rendered).not.toContain(name);
    }
  });

  it("truncates a long transcript rather than putting all of it in the list", () => {
    const summary = summariseMedia(
      outcome({
        media: new Map([["1", [media({ kind: MessageType.AUDIO })]]]),
        transcripts: new Map([
          [
            "1",
            {
              status: TranscriptionStatus.COMPLETED,
              text: "word ".repeat(200),
              language: "en",
              confidence: 0.9,
              detail: null,
            },
          ],
        ]),
        summary: { considered: 1, described: 0, transcribed: 1, withheld: 0, failed: 0 },
      }),
      CONTEXT,
    )!;

    expect(summary.items[0]!.detail!.length).toBeLessThanOrEqual(200);
  });
});
