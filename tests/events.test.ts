import { describe, expect, it } from "vitest";

import {
  EventType,
  MediaShape,
  TranscriptionStatus,
  eventTypeFor,
  renderEventContent,
  toConversationEvent,
  toConversationEvents,
  unexaminedMedia,
  type EventMedia,
  type Transcript,
} from "@/lib/model/event";
import {
  MediaClassification,
  WithheldReason,
  isHardBlocked,
  mayDescribe,
  publicMediaLabel,
} from "@/lib/media/classification";
import {
  MessageType,
  type MediaAttachment,
  type NormalizedMessage,
} from "@/lib/model/message";

function message(over: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: "1",
    timestamp: "2024-03-01T12:00:00+00:00",
    epochMs: Date.UTC(2024, 2, 1, 12),
    localIso: "2024-03-01T12:00:00",
    senderId: "a",
    senderName: "Alex",
    text: "",
    replyTo: null,
    type: MessageType.TEXT,
    hasMedia: false,
    media: [],
    reactions: [],
    edited: false,
    forwarded: false,
    ...over,
  };
}

function image(over: Partial<MediaAttachment> = {}): MediaAttachment {
  return { kind: MessageType.IMAGE, mimeType: "image/jpeg", ...over };
}

function describedImage(over: Partial<EventMedia> = {}): EventMedia {
  return {
    kind: MessageType.IMAGE,
    classification: MediaClassification.ORDINARY,
    description: "two people at a restaurant table",
    extractedText: null,
    shape: MediaShape.ORDINARY_PHOTO,
    durationSeconds: null,
    withheld: null,
    label: "Image",
    ...over,
  };
}

describe("event types cover V3 and exclude video analysis", () => {
  it("has no VIDEO event type", () => {
    expect(Object.keys(EventType)).not.toContain("VIDEO");
  });

  it("maps each message kind to its analysis path", () => {
    expect(eventTypeFor(message({ type: MessageType.TEXT }))).toBe(EventType.TEXT);
    expect(eventTypeFor(message({ type: MessageType.IMAGE }))).toBe(EventType.IMAGE);
    expect(eventTypeFor(message({ type: MessageType.AUDIO }))).toBe(EventType.AUDIO);
    expect(eventTypeFor(message({ type: MessageType.FILE }))).toBe(EventType.DOCUMENT);
    expect(eventTypeFor(message({ type: MessageType.SYSTEM }))).toBe(EventType.SYSTEM);
  });

  it("gives video an event that exists but has no analysis path", () => {
    const event = toConversationEvent(
      message({
        type: MessageType.VIDEO,
        hasMedia: true,
        media: [image({ kind: MessageType.VIDEO })],
      }),
    );
    expect(event.type).toBe(EventType.OTHER_MEDIA);
    expect(event.media[0]!.withheld).toBe(WithheldReason.NOT_SUPPORTED_IN_VERSION);
  });
});

describe("an unexamined attachment is not assumed safe", () => {
  it("classifies it UNKNOWN rather than ORDINARY", () => {
    const media = unexaminedMedia(image());
    expect(media.classification).toBe(MediaClassification.UNKNOWN);
    expect(mayDescribe(media.classification)).toBe(false);
  });

  it("carries nothing that describes the content", () => {
    const media = unexaminedMedia(image());
    expect(media.description).toBeNull();
    expect(media.extractedText).toBeNull();
    expect(media.shape).toBeNull();
  });
});

describe("classification decides what may be sent", () => {
  it("only describes ordinary content", () => {
    expect(mayDescribe(MediaClassification.ORDINARY)).toBe(true);
    for (const blocked of [
      MediaClassification.SENSITIVE,
      MediaClassification.SEXUAL_SUGGESTIVE,
      MediaClassification.SEXUAL_EXPLICIT,
      MediaClassification.VIOLENT,
      MediaClassification.GRAPHIC,
      MediaClassification.PERSONAL_DOCUMENT,
      MediaClassification.UNKNOWN,
      MediaClassification.RESTRICTED,
    ]) {
      expect(mayDescribe(blocked)).toBe(false);
    }
  });

  it("hard-blocks explicit and restricted content from any provider", () => {
    expect(isHardBlocked(MediaClassification.SEXUAL_EXPLICIT)).toBe(true);
    expect(isHardBlocked(MediaClassification.RESTRICTED)).toBe(true);
    // A sensitive image is merely not described by default - a different thing.
    expect(isHardBlocked(MediaClassification.SENSITIVE)).toBe(false);
  });
});

describe("a reader never sees an internal classification", () => {
  it("keeps classification names out of every public label", () => {
    const names = Object.values(MediaClassification);
    for (const reason of [null, ...Object.values(WithheldReason)]) {
      for (const kind of ["image", "audio", "document", "video", "other"] as const) {
        const label = publicMediaLabel(kind, reason);
        for (const name of names) expect(label).not.toContain(name);
        expect(label).not.toMatch(/_/);
      }
    }
  });

  it("says an image is private without saying what is in it", () => {
    const label = publicMediaLabel("image", WithheldReason.SENSITIVE_CONTENT);
    expect(label).toBe("Private image — not analyzed");
    expect(label.toLowerCase()).not.toContain("sexual");
    expect(label.toLowerCase()).not.toContain("explicit");
  });
});

describe("a message survives an attachment that cannot be analysed", () => {
  it("keeps the text and reports the image as present but unread", () => {
    // Spec section 8: this exact case. The words reach the analysis, the
    // photograph does not.
    const event = toConversationEvent(
      message({
        id: "7",
        type: MessageType.IMAGE,
        text: "look what I bought 😏",
        hasMedia: true,
        media: [image()],
      }),
      {
        media: new Map([
          [
            "7",
            [
              describedImage({
                classification: MediaClassification.SEXUAL_EXPLICIT,
                description: null,
                shape: null,
                withheld: WithheldReason.SENSITIVE_CONTENT,
                label: publicMediaLabel("image", WithheldReason.SENSITIVE_CONTENT),
              }),
            ],
          ],
        ]),
      },
    );

    const rendered = renderEventContent(event);
    expect(rendered).toContain("look what I bought 😏");
    expect(rendered).toContain("contents not analyzed");
    // Nothing about what the image showed, because nothing looked at it.
    expect(rendered).not.toContain("restaurant");
  });
});

describe("rendering an event for a prompt", () => {
  const transcript = (over: Partial<Transcript> = {}): Transcript => ({
    status: TranscriptionStatus.COMPLETED,
    text: "sorry, I got held up at work",
    language: "en",
    confidence: 0.94,
    detail: null,
    ...over,
  });

  it("presents a transcript as speech, marked as transcribed", () => {
    const event = toConversationEvent(
      message({ id: "3", type: MessageType.AUDIO, hasMedia: true, media: [image({ kind: MessageType.AUDIO, durationSeconds: 18.4 })] }),
      { transcripts: new Map([["3", transcript()]]) },
    );
    const rendered = renderEventContent(event);
    expect(rendered).toContain("voice message, transcribed");
    expect(rendered).toContain("sorry, I got held up at work");
  });

  it("still represents a voice message whose transcription failed", () => {
    const event = toConversationEvent(
      message({
        id: "4",
        type: MessageType.AUDIO,
        hasMedia: true,
        media: [image({ kind: MessageType.AUDIO, durationSeconds: 12 })],
      }),
      {
        transcripts: new Map([
          ["4", transcript({ status: TranscriptionStatus.FAILED, text: "", detail: "timeout" })],
        ]),
      },
    );
    const rendered = renderEventContent(event);
    expect(rendered).toContain("voice message");
    expect(rendered).toContain("no transcript available");
    // The internal failure reason is not prompt material.
    expect(rendered).not.toContain("timeout");
  });

  it("quotes screenshot text as evidence rather than paraphrasing it", () => {
    const event = toConversationEvent(
      message({ id: "5", type: MessageType.IMAGE, text: "here's the screenshot", hasMedia: true, media: [image()] }),
      {
        media: new Map([
          [
            "5",
            [
              describedImage({
                description: null,
                extractedText: "you always disappear when it matters",
                shape: MediaShape.CHAT_SCREENSHOT,
              }),
            ],
          ],
        ]),
      },
    );
    const rendered = renderEventContent(event);
    expect(rendered).toContain("screenshot of a conversation");
    expect(rendered).toContain("you always disappear when it matters");
  });

  it("marks a description as a description so it is not quoted as speech", () => {
    const event = toConversationEvent(
      message({ id: "6", type: MessageType.IMAGE, hasMedia: true, media: [image()] }),
      { media: new Map([["6", [describedImage()]]]) },
    );
    expect(renderEventContent(event)).toContain("(image, described)");
  });

  it("leaks no identifier, classification or provider name", () => {
    const event = toConversationEvent(
      message({ id: "461273", type: MessageType.IMAGE, text: "hey", hasMedia: true, media: [image()] }),
      { media: new Map([["461273", [describedImage()]]]) },
    );
    const rendered = renderEventContent(event);
    expect(rendered).not.toContain("461273");
    expect(rendered).not.toContain("ORDINARY");
    expect(rendered).not.toMatch(/\[\s*\d+\s*\]/);
  });
});

describe("the whole conversation becomes events in order", () => {
  it("preserves chronology and count", () => {
    const messages = [
      message({ id: "1", text: "hi", epochMs: 1 }),
      message({ id: "2", text: "hello", epochMs: 2 }),
      message({ id: "3", text: "how are you", epochMs: 3 }),
    ];
    const events = toConversationEvents({ messages });
    expect(events.map((e) => e.id)).toEqual(["1", "2", "3"]);
    expect(events.map((e) => e.epochMs)).toEqual([1, 2, 3]);
  });
});
