import { afterEach, describe, expect, it } from "vitest";

import {
  categoryOf,
  checkUsage,
  estimateUsage,
  mediaLimits,
  mediaLimitsFor,
  relevanceScore,
  selectMedia,
  validateAttachment,
  type MediaLimits,
} from "@/lib/media/policy";
import {
  MessageType,
  type MediaAttachment,
  type NormalizedMessage,
} from "@/lib/model/message";

afterEach(() => {
  delete process.env.MEDIA_MAX_IMAGES;
  delete process.env.MEDIA_MAX_FILE_MB;
});

function attachment(over: Partial<MediaAttachment> = {}): MediaAttachment {
  return {
    kind: MessageType.IMAGE,
    mimeType: "image/jpeg",
    reference: "photos/photo_1.jpg",
    sizeBytes: 1024,
    ...over,
  };
}

function message(
  id: number,
  over: Partial<NormalizedMessage> = {},
): NormalizedMessage {
  return {
    id: String(id),
    timestamp: "2024-03-01T12:00:00+00:00",
    epochMs: Date.UTC(2024, 2, 1, 12, id),
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

const GENEROUS: MediaLimits = {
  maxImages: 10,
  maxVideos: 3,
  maxAudioSeconds: 600,
  maxVideoSeconds: 300,
  maxFileBytes: 25 * 1024 * 1024,
  maxVideoDurationSeconds: 300,
};

describe("categories", () => {
  it("separates a voice note from a shared audio file", () => {
    expect(categoryOf(attachment({ kind: MessageType.AUDIO, mimeType: "audio/ogg" })))
      .toBe("voice");
    expect(categoryOf(attachment({ kind: MessageType.AUDIO, mimeType: "audio/mpeg" })))
      .toBe("audio");
  });

  it("recognises the kinds the product names", () => {
    expect(categoryOf(attachment())).toBe("image");
    expect(categoryOf(attachment({ kind: MessageType.VIDEO }))).toBe("video");
    expect(categoryOf(attachment({ kind: MessageType.STICKER }))).toBe("sticker");
    expect(categoryOf(attachment({ kind: MessageType.FILE }))).toBe("document");
  });

  it("has no category for something that is not media", () => {
    expect(categoryOf(attachment({ kind: MessageType.TEXT }))).toBeNull();
  });
});

describe("validation runs against untrusted input", () => {
  it("accepts a well-formed image", () => {
    expect(validateAttachment(attachment(), GENEROUS).ok).toBe(true);
  });

  it("refuses a type it cannot read", () => {
    const result = validateAttachment(
      attachment({ mimeType: "application/x-msdownload" }),
      GENEROUS,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported-type");
  });

  it("treats a missing type as unsupported rather than assuming", () => {
    const result = validateAttachment(attachment({ mimeType: undefined }), GENEROUS);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported-type");
  });

  it("refuses a mime type that disagrees with the kind", () => {
    // An "image" that declares itself a video is not something to hand a
    // vision processor on trust.
    const result = validateAttachment(
      attachment({ kind: MessageType.IMAGE, mimeType: "video/mp4" }),
      GENEROUS,
    );
    expect(result.ok).toBe(false);
  });

  it("refuses an oversized file", () => {
    const result = validateAttachment(
      attachment({ sizeBytes: 80 * 1024 * 1024 }),
      GENEROUS,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too-large");
  });

  it("refuses a video longer than the ceiling", () => {
    const result = validateAttachment(
      attachment({
        kind: MessageType.VIDEO,
        mimeType: "video/mp4",
        durationSeconds: 4_000,
      }),
      GENEROUS,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too-long");
  });

  it("refuses an attachment with nothing to read", () => {
    const result = validateAttachment(attachment({ reference: undefined }), GENEROUS);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-reference");
  });

  it("takes its ceilings from the environment", () => {
    process.env.MEDIA_MAX_FILE_MB = "1";
    const result = validateAttachment(attachment({ sizeBytes: 2 * 1024 * 1024 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too-large");
  });
});

describe("limits per product", () => {
  it("includes no media on the text products", () => {
    expect(mediaLimitsFor("free").maxImages).toBe(0);
    expect(mediaLimitsFor("deep-text").maxImages).toBe(0);
  });

  it("gives the multimodal product the deployment ceiling", () => {
    expect(mediaLimitsFor("multimodal").maxImages).toBe(mediaLimits().maxImages);
  });

  it("gives a product nobody mapped the conservative allowance", () => {
    expect(mediaLimitsFor("invented-later").maxImages).toBe(0);
  });
});

describe("cost is estimated before anything runs", () => {
  it("prices images, audio and video separately", () => {
    const usage = estimateUsage(
      [
        { messageId: "1", category: "image", attachment: attachment() },
        {
          messageId: "2",
          category: "voice",
          attachment: attachment({ durationSeconds: 120 }),
        },
        {
          messageId: "3",
          category: "video",
          attachment: attachment({ durationSeconds: 60 }),
        },
      ],
      { perImageMicros: 1_000, perAudioMinuteMicros: 6_000, perVideoMinuteMicros: 60_000 },
    );

    expect(usage.imagesProcessed).toBe(1);
    expect(usage.audioSeconds).toBe(120);
    expect(usage.videoSeconds).toBe(60);
    // 1,000 + 2 minutes of audio + 1 minute of video.
    expect(usage.estimatedCostMicros).toBe(1_000 + 12_000 + 60_000);
  });

  it("reports which limit a selection would break", () => {
    const check = checkUsage(
      { imagesProcessed: 50, audioSeconds: 10, videoSeconds: 0, estimatedCostMicros: 0 },
      0,
      GENEROUS,
    );
    expect(check.withinLimits).toBe(false);
    expect(check.exceeded).toContain("images");
  });
});

describe("relevance decides what is worth reading", () => {
  it("scores a captioned image above a silent one", () => {
    const withCaption = [
      message(1, { text: "look at this", media: [attachment()], hasMedia: true }),
      message(2, { text: "no way", senderId: "b" }),
    ];
    const silent = [message(1, { media: [attachment()], hasMedia: true })];

    expect(relevanceScore(withCaption, 0)).toBeGreaterThan(relevanceScore(silent, 0));
  });

  it("scores an image the other person answered above one nobody did", () => {
    const answered = [
      message(1, { media: [attachment()], hasMedia: true }),
      message(2, { text: "ha", senderId: "b" }),
    ];
    const ignored = [
      message(1, { media: [attachment()], hasMedia: true }),
      message(2, { text: "anyway", senderId: "a" }),
    ];
    expect(relevanceScore(answered, 0)).toBeGreaterThan(relevanceScore(ignored, 0));
  });
});

describe("selection", () => {
  it("keeps the most relevant and marks the rest over-budget", () => {
    const messages = [
      message(1, { text: "look", media: [attachment()], hasMedia: true }),
      message(2, { text: "wow", senderId: "b" }),
      message(3, { media: [attachment()], hasMedia: true }),
      message(4, { media: [attachment()], hasMedia: true }),
    ];

    const result = selectMedia(messages, { ...GENEROUS, maxImages: 1 });

    expect(result.selected).toHaveLength(1);
    // The captioned, answered one is the one that survives.
    expect(result.selected[0]!.messageId).toBe("1");
    expect(result.skipped.some((entry) => entry.reason === "over-budget")).toBe(true);
  });

  it("selects nothing when the product includes no media", () => {
    const messages = [message(1, { text: "look", media: [attachment()], hasMedia: true })];
    const result = selectMedia(messages, mediaLimitsFor("free"));

    expect(result.selected).toHaveLength(0);
    expect(result.usage.estimatedCostMicros).toBe(0);
  });

  it("leaves stickers alone", () => {
    const messages = [
      message(1, {
        media: [attachment({ kind: MessageType.STICKER })],
        hasMedia: true,
      }),
    ];
    const result = selectMedia(messages, GENEROUS);

    expect(result.selected).toHaveLength(0);
    expect(result.skipped[0]!.reason).toBe("not-relevant");
  });

  it("estimates the cost of what it chose", () => {
    const messages = [
      message(1, { text: "listen", media: [
        attachment({ kind: MessageType.AUDIO, mimeType: "audio/ogg", durationSeconds: 60 }),
      ], hasMedia: true }),
    ];
    const result = selectMedia(messages, GENEROUS);

    expect(result.selected).toHaveLength(1);
    expect(result.usage.audioSeconds).toBe(60);
    expect(result.usage.estimatedCostMicros).toBeGreaterThan(0);
  });
});
