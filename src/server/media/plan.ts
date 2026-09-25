/**
 * Deciding which attachments an analysis will ask for.
 *
 * Runs on the server, from the client's declared list of what its export
 * contains. The client never decides what gets uploaded: it says what exists,
 * and this says what is wanted. Everything else stays on the user's machine.
 *
 * Three filters, cheapest first:
 *
 *   1. Is this content type part of what was bought and consented to?
 *   2. Is the message it belongs to inside the window the analysis will read?
 *   3. Does it validate, and does it fit the product's ceilings?
 *
 * Filter 2 is the one that does most of the work. The analysis reads a budgeted
 * subset of a large conversation, and an attachment on a message outside that
 * subset cannot influence the result - so asking for it would be uploading a
 * private photograph to look at it in a context nothing will read.
 */

import type { DeclaredAttachment } from "@/lib/api/schemas";
import { MessageType, type MediaAttachment } from "@/lib/model/message";
import {
  categoryOf,
  mediaLimitsFor,
  validateAttachment,
  type MediaCategory,
  type MediaLimits,
} from "@/lib/media/policy";
import type { PlannedAsset } from "@/server/repositories/media";

/** Content types a product may look at, from the product's own declaration. */
export interface MediaScope {
  images: boolean;
  audio: boolean;
  documents: boolean;
}

export function scopeFromContentTypes(contentTypes: readonly string[]): MediaScope {
  return {
    images: contentTypes.includes("IMAGES"),
    audio: contentTypes.includes("AUDIO"),
    // Documents ride with images: both are "a file whose contents get read".
    documents: contentTypes.includes("IMAGES"),
  };
}

function inScope(category: MediaCategory, scope: MediaScope): boolean {
  switch (category) {
    case "image":
      return scope.images;
    case "voice":
    case "audio":
      return scope.audio;
    case "document":
      return scope.documents;
    // Stickers are decoration and video is out of scope for V3.
    case "sticker":
    case "video":
      return false;
    default:
      return false;
  }
}

/** The declared shape, as the validation helpers expect it. */
function toAttachment(declared: DeclaredAttachment): MediaAttachment {
  return {
    kind: declared.kind as MediaAttachment["kind"],
    ...(declared.mimeType ? { mimeType: declared.mimeType } : {}),
    ...(declared.durationSeconds !== undefined
      ? { durationSeconds: declared.durationSeconds }
      : {}),
    ...(declared.sizeBytes !== undefined ? { sizeBytes: declared.sizeBytes } : {}),
    reference: declared.reference,
  };
}

export interface MediaPlan {
  wanted: PlannedAsset[];
  /** Counted, not listed: a reason per file would be noise at this stage. */
  skipped: {
    outOfScope: number;
    outsideReadWindow: number;
    invalid: number;
    overLimit: number;
  };
}

export interface PlanOptions {
  declared: readonly DeclaredAttachment[];
  /** Message ids the analysis is actually going to read. */
  readMessageIds: ReadonlySet<string>;
  productId: string;
  scope: MediaScope;
  limits?: MediaLimits;
}

/**
 * Builds the plan.
 *
 * Order within the limits is the declared order, which is chronological because
 * the parser emits it that way. That matters: when a conversation has more
 * images than the allowance covers, the ones that get read are spread through
 * the analysed window rather than clustered wherever the biggest files are.
 */
export function planMediaFor(options: PlanOptions): MediaPlan {
  const limits = options.limits ?? mediaLimitsFor(options.productId);
  const wanted: PlannedAsset[] = [];
  const skipped = { outOfScope: 0, outsideReadWindow: 0, invalid: 0, overLimit: 0 };

  let images = 0;
  let audioSeconds = 0;
  const seen = new Set<string>();

  for (const declared of options.declared) {
    if (seen.has(declared.reference)) continue;

    const attachment = toAttachment(declared);
    const category = categoryOf(attachment);
    if (category === null || !inScope(category, options.scope)) {
      skipped.outOfScope += 1;
      continue;
    }

    if (!options.readMessageIds.has(declared.messageId)) {
      skipped.outsideReadWindow += 1;
      continue;
    }

    const validation = validateAttachment(attachment, limits);
    if (!validation.ok) {
      skipped.invalid += 1;
      continue;
    }

    if (category === "image" || category === "document") {
      if (images + 1 > limits.maxImages) {
        skipped.overLimit += 1;
        continue;
      }
      images += 1;
    } else {
      const duration = declared.durationSeconds ?? 0;
      if (audioSeconds + duration > limits.maxAudioSeconds) {
        skipped.overLimit += 1;
        continue;
      }
      audioSeconds += duration;
    }

    seen.add(declared.reference);
    wanted.push({
      messageId: declared.messageId,
      reference: declared.reference,
      category,
      mimeType: declared.mimeType ?? defaultMime(category),
      declaredSizeBytes: declared.sizeBytes ?? 0,
    });
  }

  return { wanted, skipped };
}

/** A best guess, used only when the export omitted the type. */
function defaultMime(category: MediaCategory): string {
  switch (category) {
    case "image":
      return "image/jpeg";
    case "voice":
      return "audio/ogg";
    case "audio":
      return "audio/mpeg";
    case "document":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

/** Message ids present in the excerpts the analysis will read. */
export function readMessageIdsFrom(
  excerpts: readonly { messages: readonly { id: string }[] }[],
): Set<string> {
  const ids = new Set<string>();
  for (const excerpt of excerpts) {
    for (const message of excerpt.messages) ids.add(message.id);
  }
  return ids;
}

/** Kinds the plan can ever accept, for the client to filter on before sending. */
export const PLANNABLE_KINDS: readonly MessageType[] = [
  MessageType.IMAGE,
  MessageType.AUDIO,
  MessageType.FILE,
];
