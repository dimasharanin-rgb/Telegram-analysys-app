import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MIN_MODERATION_CONFIDENCE,
  passThroughGateway,
  shapeIsHighValue,
  type GatewayDeps,
  type GatewayRequest,
} from "@/lib/media/gateway";
import { mediaLimits } from "@/lib/media/policy";
import { MediaClassification, WithheldReason } from "@/lib/media/classification";
import { MediaShape } from "@/lib/model/event";
import { MessageType, type MediaAttachment } from "@/lib/model/message";
import type {
  MediaPayload,
  ModerationProvider,
  ModerationVerdict,
  ProviderResult,
  VisionFinding,
  VisionProvider,
} from "@/lib/media/providers/types";

function image(over: Partial<MediaAttachment> = {}): MediaAttachment {
  return {
    kind: MessageType.IMAGE,
    mimeType: "image/jpeg",
    reference: "photos/photo_1.jpg",
    sizeBytes: 2048,
    ...over,
  };
}

const PAYLOAD: MediaPayload = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "image/jpeg",
};

function verdict(over: Partial<ModerationVerdict> = {}): ProviderResult<ModerationVerdict> {
  return {
    ok: true,
    classification: MediaClassification.ORDINARY,
    suspectedIllegal: false,
    confidence: 0.95,
    ...over,
  };
}

function finding(over: Partial<VisionFinding> = {}): ProviderResult<VisionFinding> {
  return {
    ok: true,
    description: "a plate of food on a table",
    extractedText: null,
    shape: MediaShape.ORDINARY_PHOTO,
    confidence: "high",
    ...over,
  };
}

interface Harness {
  deps: GatewayDeps;
  classify: ReturnType<typeof vi.fn>;
  describe_: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
}

function harness(options: {
  moderation?: ProviderResult<ModerationVerdict> | Error;
  vision?: ProviderResult<VisionFinding> | Error;
  withoutModeration?: boolean;
  withoutVision?: boolean;
  loadFails?: boolean;
  loadReturnsNull?: boolean;
}): Harness {
  const classify = vi.fn(async (): Promise<ProviderResult<ModerationVerdict>> => {
    if (options.moderation instanceof Error) throw options.moderation;
    return options.moderation ?? verdict();
  });

  const describe_ = vi.fn(async (): Promise<ProviderResult<VisionFinding>> => {
    if (options.vision instanceof Error) throw options.vision;
    return options.vision ?? finding();
  });

  const load = vi.fn(async (): Promise<MediaPayload | null> => {
    if (options.loadFails === true) throw new Error("EACCES");
    if (options.loadReturnsNull === true) return null;
    return PAYLOAD;
  });

  const moderation: ModerationProvider = { name: "fake", classify };
  const vision: VisionProvider = { name: "fake", describe: describe_ };

  return {
    deps: {
      moderation: options.withoutModeration === true ? null : moderation,
      vision: options.withoutVision === true ? null : vision,
      load,
    },
    classify,
    describe_,
    load,
  };
}

function request(over: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    attachment: image(),
    limits: mediaLimits(),
    consented: true,
    relevant: true,
    affordable: true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("nothing is described without moderation clearing it", () => {
  it("describes nothing at all when no moderation provider is configured", async () => {
    const h = harness({ withoutModeration: true });
    const { media } = await passThroughGateway(request(), h.deps);

    expect(media.classification).toBe(MediaClassification.UNKNOWN);
    expect(media.withheld).toBe(WithheldReason.NOT_MODERATED);
    expect(media.description).toBeNull();
    // The decisive assertion: the vision model was never asked, and the file
    // was never even read off disk.
    expect(h.describe_).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
  });

  it("treats an unreadable verdict as no permission", async () => {
    const h = harness({ moderation: { ok: false, detail: "status_500", retryable: true } });
    const { media } = await passThroughGateway(request(), h.deps);

    expect(media.withheld).toBe(WithheldReason.PROVIDER_FAILED);
    expect(h.describe_).not.toHaveBeenCalled();
  });

  it("treats a thrown moderation error as no permission", async () => {
    const h = harness({ moderation: new Error("boom") });
    const { media } = await passThroughGateway(request(), h.deps);

    expect(media.withheld).toBe(WithheldReason.PROVIDER_FAILED);
    expect(h.describe_).not.toHaveBeenCalled();
  });

  it("does not trust a verdict it is not confident in", async () => {
    const h = harness({
      moderation: verdict({
        classification: MediaClassification.ORDINARY,
        confidence: MIN_MODERATION_CONFIDENCE - 0.01,
      }),
    });
    const { media } = await passThroughGateway(request(), h.deps);

    // "Probably fine" is not fine.
    expect(media.classification).toBe(MediaClassification.UNKNOWN);
    expect(h.describe_).not.toHaveBeenCalled();
  });

  it("accepts a confident verdict", async () => {
    const h = harness({
      moderation: verdict({ confidence: MIN_MODERATION_CONFIDENCE }),
    });
    const { media } = await passThroughGateway(request(), h.deps);
    expect(media.description).toBe("a plate of food on a table");
  });
});

describe("explicit content never reaches an analysis model", () => {
  it("withholds an explicit image and never describes it", async () => {
    const h = harness({
      moderation: verdict({ classification: MediaClassification.SEXUAL_EXPLICIT }),
    });
    const { media, halt } = await passThroughGateway(request(), h.deps);

    expect(media.classification).toBe(MediaClassification.SEXUAL_EXPLICIT);
    expect(media.withheld).toBe(WithheldReason.SENSITIVE_CONTENT);
    expect(media.description).toBeNull();
    expect(media.extractedText).toBeNull();
    expect(h.describe_).not.toHaveBeenCalled();
    expect(halt).toBe(false);
  });

  it("halts on suspected illegal content and seeks no second opinion", async () => {
    const h = harness({
      moderation: verdict({ suspectedIllegal: true, classification: MediaClassification.UNKNOWN }),
    });
    const { media, halt } = await passThroughGateway(request(), h.deps);

    expect(halt).toBe(true);
    expect(media.classification).toBe(MediaClassification.RESTRICTED);
    expect(media.description).toBeNull();
    // Classified once. Never re-classified through another model as a
    // workaround, and never described.
    expect(h.classify).toHaveBeenCalledTimes(1);
    expect(h.describe_).not.toHaveBeenCalled();
  });

  it("halts even when the provider reports low confidence", async () => {
    const h = harness({
      moderation: verdict({ suspectedIllegal: true, confidence: 0.2 }),
    });
    const { halt } = await passThroughGateway(request(), h.deps);
    // The illegal signal is not subject to the confidence threshold: it is a
    // stop, not a score.
    expect(halt).toBe(true);
  });
});

describe("sensitive content is preserved without being examined", () => {
  it.each([
    MediaClassification.SENSITIVE,
    MediaClassification.SEXUAL_SUGGESTIVE,
    MediaClassification.VIOLENT,
    MediaClassification.GRAPHIC,
    MediaClassification.PERSONAL_DOCUMENT,
  ])("does not describe %s content", async (classification) => {
    const h = harness({ moderation: verdict({ classification }) });
    const { media } = await passThroughGateway(request(), h.deps);

    expect(media.classification).toBe(classification);
    expect(media.withheld).toBe(WithheldReason.SENSITIVE_CONTENT);
    expect(h.describe_).not.toHaveBeenCalled();
  });

  it("still records that the attachment existed, and when", async () => {
    const h = harness({
      moderation: verdict({ classification: MediaClassification.SENSITIVE }),
    });
    const { media } = await passThroughGateway(
      request({ attachment: image({ durationSeconds: undefined }) }),
      h.deps,
    );

    expect(media.kind).toBe(MessageType.IMAGE);
    expect(media.label).toBeTruthy();
    expect(media.label).not.toContain("SENSITIVE");
  });
});

describe("consent is checked before anything is read", () => {
  it("refuses without consent and never opens the file", async () => {
    const h = harness({});
    const { media } = await passThroughGateway(request({ consented: false }), h.deps);

    expect(media.withheld).toBe(WithheldReason.NO_CONSENT);
    // Ordered ahead of relevance and budget on purpose: a refusal is not a
    // cost decision, so no path can reach a provider by first deciding the
    // image was cheap enough.
    expect(h.load).not.toHaveBeenCalled();
    expect(h.classify).not.toHaveBeenCalled();
    expect(h.describe_).not.toHaveBeenCalled();
  });

  it("refuses without consent even for an image that would have been ordinary", async () => {
    const h = harness({ moderation: verdict({ classification: MediaClassification.ORDINARY }) });
    const { media } = await passThroughGateway(
      request({ consented: false, relevant: true, affordable: true }),
      h.deps,
    );
    expect(media.description).toBeNull();
  });
});

describe("relevance and allowance gate the expensive step", () => {
  it("skips describing an image nothing made relevant", async () => {
    const h = harness({});
    const { media } = await passThroughGateway(request({ relevant: false }), h.deps);

    expect(media.withheld).toBe(WithheldReason.NOT_RELEVANT);
    expect(media.classification).toBe(MediaClassification.ORDINARY);
    // Cleared, but reading it would buy nothing.
    expect(h.describe_).not.toHaveBeenCalled();
  });

  it("stops at the allowance rather than overspending", async () => {
    const h = harness({});
    const { media } = await passThroughGateway(request({ affordable: false }), h.deps);

    expect(media.withheld).toBe(WithheldReason.ALLOWANCE_SPENT);
    expect(h.describe_).not.toHaveBeenCalled();
  });
});

describe("a failure leaves the message intact", () => {
  it("reports an unreadable file without failing the analysis", async () => {
    const h = harness({ loadFails: true });
    const { media } = await passThroughGateway(request(), h.deps);

    expect(media.withheld).toBe(WithheldReason.PROVIDER_FAILED);
    expect(media.kind).toBe(MessageType.IMAGE);
  });

  it("reports a missing file the same way", async () => {
    const h = harness({ loadReturnsNull: true });
    const { media } = await passThroughGateway(request(), h.deps);
    expect(media.withheld).toBe(WithheldReason.PROVIDER_FAILED);
  });

  it("survives a vision model that throws", async () => {
    const h = harness({ vision: new Error("overloaded") });
    const { media } = await passThroughGateway(request(), h.deps);

    expect(media.withheld).toBe(WithheldReason.PROVIDER_FAILED);
    // Cleared, so the classification is kept - only the description is missing.
    expect(media.classification).toBe(MediaClassification.ORDINARY);
  });

  it("survives a vision provider that is not configured", async () => {
    const h = harness({ withoutVision: true });
    const { media } = await passThroughGateway(request(), h.deps);
    expect(media.withheld).toBe(WithheldReason.PROVIDER_FAILED);
  });

  it("never leaks a provider's error text into anything user-visible", async () => {
    const h = harness({ vision: new Error("AI provider said: secret-key-abc123") });
    const { media } = await passThroughGateway(request(), h.deps);

    expect(media.label).not.toContain("secret-key");
    expect(media.description).toBeNull();
  });
});

describe("files we do not accept stop before any provider", () => {
  it("rejects an oversized file locally", async () => {
    const h = harness({});
    const { media } = await passThroughGateway(
      request({ attachment: image({ sizeBytes: 500 * 1024 * 1024 }) }),
      h.deps,
    );

    expect(media.withheld).toBe(WithheldReason.UNSUPPORTED);
    expect(h.load).not.toHaveBeenCalled();
  });

  it("rejects a type we do not handle", async () => {
    const h = harness({});
    const { media } = await passThroughGateway(
      request({ attachment: image({ mimeType: "image/tiff" }) }),
      h.deps,
    );
    expect(media.withheld).toBe(WithheldReason.UNSUPPORTED);
    expect(h.classify).not.toHaveBeenCalled();
  });

  it("rejects an attachment with no file behind it", async () => {
    const h = harness({});
    const { media } = await passThroughGateway(
      request({ attachment: image({ reference: undefined }) }),
      h.deps,
    );
    expect(media.withheld).toBe(WithheldReason.UNSUPPORTED);
  });
});

describe("V3 analyses no video", () => {
  it("stops a video before any provider is involved", async () => {
    const h = harness({});
    const { media } = await passThroughGateway(
      request({
        attachment: image({ kind: MessageType.VIDEO, mimeType: "video/mp4", durationSeconds: 30 }),
      }),
      h.deps,
    );

    expect(media.withheld).toBe(WithheldReason.NOT_SUPPORTED_IN_VERSION);
    expect(h.load).not.toHaveBeenCalled();
    expect(h.classify).not.toHaveBeenCalled();
    expect(h.describe_).not.toHaveBeenCalled();
  });

  it("still represents the video and its duration", async () => {
    const h = harness({});
    const { media } = await passThroughGateway(
      request({
        attachment: image({ kind: MessageType.VIDEO, mimeType: "video/mp4", durationSeconds: 42 }),
      }),
      h.deps,
    );
    expect(media.kind).toBe(MessageType.VIDEO);
    expect(media.durationSeconds).toBe(42);
  });
});

describe("a cleared, relevant image is read", () => {
  it("returns the description and no withholding reason", async () => {
    const h = harness({});
    const { media } = await passThroughGateway(request(), h.deps);

    expect(media.withheld).toBeNull();
    expect(media.description).toBe("a plate of food on a table");
    expect(media.shape).toBe(MediaShape.ORDINARY_PHOTO);
    expect(h.describe_).toHaveBeenCalledTimes(1);
  });

  it("keeps screenshot text verbatim as evidence", async () => {
    const h = harness({
      vision: finding({
        description: "a screenshot of a messaging app",
        extractedText: "you always disappear when it matters",
        shape: MediaShape.CHAT_SCREENSHOT,
      }),
    });
    const { media } = await passThroughGateway(request(), h.deps);

    expect(media.extractedText).toBe("you always disappear when it matters");
    expect(media.shape).toBe(MediaShape.CHAT_SCREENSHOT);
  });

  it("treats blank extracted text as no text", async () => {
    const h = harness({ vision: finding({ extractedText: "   " }) });
    const { media } = await passThroughGateway(request(), h.deps);
    expect(media.extractedText).toBeNull();
  });
});

describe("screenshots are worth reading even beside dull text", () => {
  it("marks screenshot shapes as high value", () => {
    expect(shapeIsHighValue(MediaShape.CHAT_SCREENSHOT)).toBe(true);
    expect(shapeIsHighValue(MediaShape.DOCUMENT_SCREENSHOT)).toBe(true);
    expect(shapeIsHighValue(MediaShape.SCREENSHOT)).toBe(true);
  });

  it("does not privilege a landscape photograph or a meme", () => {
    expect(shapeIsHighValue(MediaShape.ORDINARY_PHOTO)).toBe(false);
    expect(shapeIsHighValue(MediaShape.MEME)).toBe(false);
    expect(shapeIsHighValue(null)).toBe(false);
  });
});
