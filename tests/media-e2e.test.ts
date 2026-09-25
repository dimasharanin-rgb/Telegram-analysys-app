/**
 * The media path end to end, with fake providers.
 *
 * Everything real except the two external services: the plan, the upload
 * gate, private storage, the gateway's routing rules, transcription, the
 * findings on the result, and the deletion of the bytes afterwards.
 *
 * The providers are faked because the alternative is either spending money on
 * every test run or having no test for the part most likely to leak someone's
 * photograph.
 */

import { mkdtempSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetServerConfigCache } from "@/lib/config";
import { MediaClassification, WithheldReason } from "@/lib/media/classification";
import { TranscriptionStatus } from "@/lib/model/event";
import { planMediaFor } from "@/server/media/plan";
import { processJobMedia } from "@/server/media/process";
import { storageKeyFor, writeMedia } from "@/server/media/storage";
import {
  listMediaAssets,
  markStored,
  planMedia,
} from "@/server/repositories/media";
import type { DeclaredAttachment } from "@/lib/api/schemas";
import { seedConversation, withTestDatabase } from "./support/db";
import * as registry from "@/lib/media/providers/registry";
import type { MediaProviders } from "@/lib/media/providers/registry";
import { createJob } from "@/server/repositories/jobs";

withTestDatabase();

let storageDir: string;

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), "media-e2e-"));
  process.env.MEDIA_STORAGE_DIR = storageDir;
  resetServerConfigCache();
});

afterEach(() => {
  delete process.env.MEDIA_STORAGE_DIR;
  resetServerConfigCache();
  vi.restoreAllMocks();
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4]);

function declared(over: Partial<DeclaredAttachment> = {}): DeclaredAttachment {
  return {
    messageId: "1",
    reference: "photos/photo_1.jpg",
    kind: "IMAGE",
    mimeType: "image/jpeg",
    sizeBytes: JPEG.byteLength,
    ...over,
  };
}

/** A job row to hang media off, without running the whole analysis. */
function jobFor(ownerId: string, conversationId: string) {
  return createJob({
    ownerId,
    conversationId,
    productId: "multimodal",
    analysisType: "multimodal",
    modules: ["COMMUNICATION"],
    contentTypes: ["TEXT", "IMAGES", "AUDIO"],
    depth: "deep",
    status: "CREATED",
    inputMessageCount: 10,
    inputExcerptChars: 500,
    estimatedCostMicros: 0,
  });
}

function fakeProviders(options: {
  classification?: MediaClassification;
  suspectedIllegal?: boolean;
  transcript?: string;
  transcriptionFails?: boolean;
}): MediaProviders {
  return {
    moderation: {
      name: "fake",
      classify: async () => ({
        ok: true as const,
        classification: options.classification ?? MediaClassification.ORDINARY,
        suspectedIllegal: options.suspectedIllegal ?? false,
        confidence: 0.95,
      }),
    },
    vision: {
      name: "fake",
      describe: async () => ({
        ok: true as const,
        description: "two people at a restaurant table",
        extractedText: null,
        shape: "ORDINARY_PHOTO" as const,
        confidence: "high" as const,
      }),
    },
    transcription: {
      name: "fake",
      transcribe: async () =>
        options.transcriptionFails === true
          ? {
              status: TranscriptionStatus.FAILED,
              text: "",
              language: null,
              confidence: null,
              detail: "provider_error",
            }
          : {
              status: TranscriptionStatus.COMPLETED,
              text: options.transcript ?? "I'll be late, don't wait up",
              language: "en",
              confidence: 0.93,
              detail: null,
            },
    },
  };
}

/** Plans, stores and processes one attachment; returns what the analysis learned. */
async function runMedia(options: {
  attachment: DeclaredAttachment;
  bytes: Uint8Array;
  providers: MediaProviders;
  text?: string;
  consented?: { images: boolean; audio: boolean };
}) {
  const { ownerId, conversation } = seedConversation();
  const job = jobFor(ownerId, conversation.id);

  const plan = planMediaFor({
    declared: [options.attachment],
    readMessageIds: new Set(["1"]),
    productId: "multimodal",
    scope: { images: true, audio: true, documents: true },
  });
  expect(plan.wanted).toHaveLength(1);
  planMedia(job.id, ownerId, plan.wanted);

  const asset = listMediaAssets(job.id, ownerId)[0]!;
  const storageKey = storageKeyFor(ownerId, job.id, asset.reference);
  await writeMedia(storageKey, options.bytes);
  markStored(asset.id, storageKey, options.bytes.byteLength, asset.mimeType);

  vi.spyOn(registry, "mediaProviders").mockReturnValue(options.providers);

  const outcome = await processJobMedia({
    jobId: job.id,
    ownerId,
    productId: "multimodal",
    textById: new Map([["1", options.text ?? "look at this"]]),
    orderedIds: ["1"],
    consented: options.consented ?? { images: true, audio: true },
    analyser: null,
  });

  return { outcome, ownerId, jobId: job.id, storageKey, assetId: asset.id };
}

describe("an ordinary image the conversation pointed at", () => {
  it("is described, and the description reaches the analysis", async () => {
    const { outcome } = await runMedia({
      attachment: declared(),
      bytes: JPEG,
      providers: fakeProviders({}),
    });

    const media = outcome.media.get("1")!;
    expect(media[0]!.withheld).toBeNull();
    expect(media[0]!.description).toBe("two people at a restaurant table");
    expect(outcome.summary.described).toBe(1);
  });

  it("is recorded against the asset, so the report can cite it", async () => {
    const { ownerId, jobId } = await runMedia({
      attachment: declared(),
      bytes: JPEG,
      providers: fakeProviders({}),
    });

    const asset = listMediaAssets(jobId, ownerId)[0]!;
    expect(asset.status).toBe("PROCESSED");
    expect(asset.classification).toBe(MediaClassification.ORDINARY);
    expect(asset.description).toBe("two people at a restaurant table");
  });
});

describe("an explicit image", () => {
  it("is never described, and the message keeps its words", async () => {
    const { outcome, ownerId, jobId } = await runMedia({
      attachment: declared(),
      bytes: JPEG,
      providers: fakeProviders({ classification: MediaClassification.SEXUAL_EXPLICIT }),
      text: "look what I bought 😏",
    });

    const media = outcome.media.get("1")!;
    expect(media[0]!.description).toBeNull();
    expect(media[0]!.withheld).toBe(WithheldReason.SENSITIVE_CONTENT);
    expect(outcome.summary.described).toBe(0);
    expect(outcome.summary.withheld).toBe(1);

    const asset = listMediaAssets(jobId, ownerId)[0]!;
    expect(asset.description).toBeNull();
    expect(asset.extractedText).toBeNull();
  });
});

describe("suspected illegal content", () => {
  it("is recorded as restricted and nothing about it is stored", async () => {
    const { outcome, ownerId, jobId } = await runMedia({
      attachment: declared(),
      bytes: JPEG,
      providers: fakeProviders({ suspectedIllegal: true }),
    });

    expect(outcome.media.get("1")![0]!.classification).toBe(
      MediaClassification.RESTRICTED,
    );
    const asset = listMediaAssets(jobId, ownerId)[0]!;
    expect(asset.description).toBeNull();
    expect(asset.extractedText).toBeNull();
  });
});

describe("a voice message", () => {
  it("is transcribed, and the transcript becomes part of the conversation", async () => {
    const { outcome } = await runMedia({
      attachment: declared({
        reference: "voice_messages/audio_1.ogg",
        kind: "AUDIO",
        mimeType: "audio/ogg",
        durationSeconds: 12,
        sizeBytes: OGG.byteLength,
      }),
      bytes: OGG,
      providers: fakeProviders({}),
    });

    const transcript = outcome.transcripts.get("1")!;
    expect(transcript.status).toBe(TranscriptionStatus.COMPLETED);
    expect(transcript.text).toBe("I'll be late, don't wait up");
    expect(outcome.summary.transcribed).toBe(1);
  });

  it("survives a failed transcription without losing the message", async () => {
    const { outcome } = await runMedia({
      attachment: declared({
        reference: "voice_messages/audio_1.ogg",
        kind: "AUDIO",
        mimeType: "audio/ogg",
        durationSeconds: 12,
        sizeBytes: OGG.byteLength,
      }),
      bytes: OGG,
      providers: fakeProviders({ transcriptionFails: true }),
    });

    expect(outcome.transcripts.get("1")!.status).toBe(TranscriptionStatus.FAILED);
    // The attachment is still represented; only the words are missing.
    expect(outcome.media.get("1")).toHaveLength(1);
    expect(outcome.summary.failed).toBe(1);
  });
});

describe("consent is enforced at the point of processing", () => {
  it("does not describe an image when images were not consented to", async () => {
    const { outcome } = await runMedia({
      attachment: declared(),
      bytes: JPEG,
      providers: fakeProviders({}),
      consented: { images: false, audio: true },
    });

    expect(outcome.media.get("1")![0]!.withheld).toBe(WithheldReason.NO_CONSENT);
    expect(outcome.media.get("1")![0]!.description).toBeNull();
  });

  it("does not transcribe when audio was not consented to", async () => {
    const { outcome } = await runMedia({
      attachment: declared({
        reference: "voice_messages/audio_1.ogg",
        kind: "AUDIO",
        mimeType: "audio/ogg",
        durationSeconds: 12,
        sizeBytes: OGG.byteLength,
      }),
      bytes: OGG,
      providers: fakeProviders({}),
      consented: { images: true, audio: false },
    });

    expect(outcome.transcripts.has("1")).toBe(false);
    expect(outcome.media.get("1")![0]!.withheld).toBe(WithheldReason.NO_CONSENT);
  });
});

describe("the bytes do not outlive the analysis", () => {
  it("deletes the uploaded file once processing finishes", async () => {
    const { storageKey } = await runMedia({
      attachment: declared(),
      bytes: JPEG,
      providers: fakeProviders({}),
    });

    expect(existsSync(join(storageDir, storageKey))).toBe(false);
  });

  it("forgets where the file was, while keeping the findings", async () => {
    const { ownerId, jobId } = await runMedia({
      attachment: declared(),
      bytes: JPEG,
      providers: fakeProviders({}),
    });

    const asset = listMediaAssets(jobId, ownerId)[0]!;
    expect(asset.storageKey).toBeNull();
    expect(asset.description).not.toBeNull();
  });

  it("leaves no stray files behind in the storage directory", async () => {
    const { ownerId } = await runMedia({
      attachment: declared(),
      bytes: JPEG,
      providers: fakeProviders({}),
    });

    const ownerDir = join(storageDir, ownerId.replace(/[^A-Za-z0-9_-]/g, ""));
    if (!existsSync(ownerDir)) return;
    const remaining = await readdir(ownerDir, { recursive: true });
    const files = remaining.filter((entry) => typeof entry === "string" && entry.includes("/"));
    expect(files).toEqual([]);
  });
});
