/**
 * Running the media pipeline for one analysis.
 *
 * Reads the files the client uploaded, puts each through the part of the
 * pipeline that suits it, records what was learned, and deletes the bytes.
 *
 *   image / document  gateway: moderate, then describe if cleared and relevant
 *   voice / audio     transcribe
 *
 * Two things this function guarantees to its caller:
 *
 * It never throws. Every provider failure, missing file and refusal becomes a
 * recorded outcome, because §40 requires a failed attachment to leave the rest
 * of the analysis running. The worst case is an analysis of the text with a
 * list of attachments it could not read, which is a real answer.
 *
 * The bytes are gone when it returns. They existed to produce findings, and the
 * findings are what the report cites. Keeping someone's photographs after the
 * thing that needed them has finished is storing private data for no purpose.
 */

import { log } from "@/lib/logger";
import { MediaClassification, WithheldReason, publicMediaLabel } from "@/lib/media/classification";
import { mediaLimitsFor } from "@/lib/media/policy";
import { passThroughGateway } from "@/lib/media/gateway";
import { mediaProviders } from "@/lib/media/providers/registry";
import type { MediaPayload } from "@/lib/media/providers/types";
import { TranscriptionStatus, type EventMedia, type Transcript } from "@/lib/model/event";
import { MessageType, type MediaAttachment } from "@/lib/model/message";
import type { AttachmentAnalyser } from "@/lib/ai/claude";
import { deleteJobMedia, readMedia } from "./storage";
import { neighbourTexts, relevanceOf } from "./relevance";
import {
  clearStorageKeys,
  listMediaAssets,
  recordFindings,
  type MediaAssetRecord,
} from "@/server/repositories/media";

export interface ProcessMediaOptions {
  jobId: string;
  ownerId: string;
  productId: string;
  /** Message text the analysis will read, for the relevance signal. */
  textById: ReadonlyMap<string, string>;
  /** Those message ids in conversation order. */
  orderedIds: readonly string[];
  /** Content types the participants consented to. */
  consented: { images: boolean; audio: boolean };
  analyser: AttachmentAnalyser | null;
  signal?: AbortSignal;
}

export interface MediaOutcome {
  /** Per message id, what the analysis may know about its attachments. */
  media: Map<string, EventMedia[]>;
  transcripts: Map<string, Transcript>;
  summary: {
    considered: number;
    described: number;
    transcribed: number;
    withheld: number;
    failed: number;
  };
}

const EMPTY: MediaOutcome = {
  media: new Map(),
  transcripts: new Map(),
  summary: { considered: 0, described: 0, transcribed: 0, withheld: 0, failed: 0 },
};

export async function processJobMedia(
  options: ProcessMediaOptions,
): Promise<MediaOutcome> {
  const assets = listMediaAssets(options.jobId, options.ownerId).filter(
    (asset) => asset.status === "STORED" && asset.storageKey !== null,
  );
  if (assets.length === 0) return EMPTY;

  const providers = mediaProviders(options.analyser);
  const limits = mediaLimitsFor(options.productId);

  const outcome: MediaOutcome = {
    media: new Map(),
    transcripts: new Map(),
    summary: { considered: assets.length, described: 0, transcribed: 0, withheld: 0, failed: 0 },
  };

  // Score first, then spend. Processing in relevance order means that when the
  // allowance runs out it runs out on the images nothing pointed at, rather
  // than on whichever happened to come last in the export.
  const scored = assets
    .map((asset) => ({
      asset,
      relevance: relevanceOf({
        text: options.textById.get(asset.messageId) ?? "",
        neighbours: neighbourTexts(options.orderedIds, options.textById, asset.messageId),
      }),
    }))
    .sort((a, b) => b.relevance.score - a.relevance.score);

  let imagesDescribed = 0;
  let audioSecondsSpent = 0;
  let halted = false;

  try {
    for (const { asset, relevance } of scored) {
      options.signal?.throwIfAborted();

      // A hard stop earlier in this job means we stop looking at this owner's
      // media entirely, rather than carrying on with the next file.
      if (halted) {
        record(outcome, asset, withheldMedia(asset, WithheldReason.SENSITIVE_CONTENT));
        outcome.summary.withheld += 1;
        continue;
      }

      const payload = await loadPayload(asset);
      if (payload === null) {
        record(outcome, asset, withheldMedia(asset, WithheldReason.PROVIDER_FAILED));
        outcome.summary.failed += 1;
        continue;
      }

      if (asset.category === "voice" || asset.category === "audio") {
        if (!options.consented.audio) {
          record(outcome, asset, withheldMedia(asset, WithheldReason.NO_CONSENT));
          outcome.summary.withheld += 1;
          continue;
        }
        const duration = payload.durationSeconds ?? 0;
        if (audioSecondsSpent + duration > limits.maxAudioSeconds) {
          record(outcome, asset, withheldMedia(asset, WithheldReason.ALLOWANCE_SPENT));
          outcome.summary.withheld += 1;
          continue;
        }

        const transcript =
          providers.transcription === null
            ? notAttemptedTranscript()
            : await providers.transcription.transcribe(payload);

        audioSecondsSpent += duration;
        outcome.transcripts.set(asset.messageId, transcript);
        record(outcome, asset, transcribedMedia(asset, transcript));

        if (transcript.status === TranscriptionStatus.COMPLETED) {
          outcome.summary.transcribed += 1;
        } else if (transcript.status === TranscriptionStatus.FAILED) {
          outcome.summary.failed += 1;
        }

        recordFindings(asset.id, {
          classification: null,
          withheldReason:
            transcript.status === TranscriptionStatus.COMPLETED
              ? null
              : WithheldReason.PROVIDER_FAILED,
          description: null,
          extractedText: null,
          shape: null,
          transcriptStatus: transcript.status,
          // The transcript is what the analysis reads, so it is stored like any
          // other evidence and pruned with the rest when the job completes.
          transcriptText: transcript.text.length > 0 ? transcript.text : null,
          transcriptLanguage: transcript.language,
        });
        continue;
      }

      // --- Images and documents go through the gateway -------------------
      const result = await passThroughGateway(
        {
          attachment: toAttachment(asset),
          limits,
          consented: options.consented.images,
          relevant: relevance.score > 0,
          affordable: imagesDescribed < limits.maxImages,
        },
        {
          moderation: providers.moderation,
          vision: providers.vision,
          load: async () => payload,
        },
      );

      if (result.media.withheld === null) {
        imagesDescribed += 1;
        outcome.summary.described += 1;
      } else if (result.media.withheld === WithheldReason.PROVIDER_FAILED) {
        outcome.summary.failed += 1;
      } else {
        outcome.summary.withheld += 1;
      }

      if (result.halt) {
        halted = true;
        log.error("media.job_halted", { jobId: options.jobId });
      }

      record(outcome, asset, result.media);
      recordFindings(asset.id, {
        classification: result.media.classification,
        withheldReason: result.media.withheld,
        description: result.media.description,
        extractedText: result.media.extractedText,
        shape: result.media.shape,
        transcriptStatus: null,
        transcriptText: null,
        transcriptLanguage: null,
      });
    }
  } catch (error) {
    // An abort, or something genuinely unexpected. Whatever was learned so far
    // still stands; the analysis continues with it.
    log.warn("media.processing_interrupted", {
      jobId: options.jobId,
      reason: error instanceof Error ? error.name : "unknown",
    });
  } finally {
    // The bytes have done their job either way.
    await deleteJobMedia(options.ownerId, options.jobId).catch(() => {});
    clearStorageKeys(options.jobId);
  }

  log.info("media.processed", { jobId: options.jobId, ...outcome.summary });
  return outcome;
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

async function loadPayload(asset: MediaAssetRecord): Promise<MediaPayload | null> {
  if (asset.storageKey === null) return null;
  const bytes = await readMedia(asset.storageKey);
  if (bytes === null) return null;
  return { bytes, mimeType: asset.mimeType };
}

function toAttachment(asset: MediaAssetRecord): MediaAttachment {
  return {
    kind: kindOf(asset),
    mimeType: asset.mimeType,
    reference: asset.reference,
    sizeBytes: asset.storedSizeBytes ?? asset.declaredSizeBytes,
  };
}

function kindOf(asset: MediaAssetRecord): MediaAttachment["kind"] {
  switch (asset.category) {
    case "image":
      return MessageType.IMAGE;
    case "voice":
    case "audio":
      return MessageType.AUDIO;
    case "document":
      return MessageType.FILE;
    default:
      return MessageType.UNKNOWN;
  }
}

function uiKindOf(asset: MediaAssetRecord): "image" | "audio" | "document" | "other" {
  if (asset.category === "image") return "image";
  if (asset.category === "voice" || asset.category === "audio") return "audio";
  if (asset.category === "document") return "document";
  return "other";
}

function withheldMedia(asset: MediaAssetRecord, reason: WithheldReason): EventMedia {
  return {
    kind: kindOf(asset),
    classification: MediaClassification.UNKNOWN,
    description: null,
    extractedText: null,
    shape: null,
    durationSeconds: null,
    withheld: reason,
    label: publicMediaLabel(uiKindOf(asset), reason),
  };
}

function transcribedMedia(asset: MediaAssetRecord, transcript: Transcript): EventMedia {
  const completed = transcript.status === TranscriptionStatus.COMPLETED;
  const reason = completed ? null : WithheldReason.PROVIDER_FAILED;

  return {
    kind: MessageType.AUDIO,
    classification: MediaClassification.UNKNOWN,
    description: null,
    extractedText: null,
    shape: null,
    durationSeconds: null,
    withheld: reason,
    label: completed
      ? "Voice message — transcript available"
      : publicMediaLabel("audio", reason),
  };
}

function notAttemptedTranscript(): Transcript {
  return {
    status: TranscriptionStatus.NOT_ATTEMPTED,
    text: "",
    language: null,
    confidence: null,
    detail: "no_provider",
  };
}

function record(outcome: MediaOutcome, asset: MediaAssetRecord, media: EventMedia): void {
  const existing = outcome.media.get(asset.messageId);
  if (existing === undefined) {
    outcome.media.set(asset.messageId, [media]);
  } else {
    existing.push(media);
  }
}
