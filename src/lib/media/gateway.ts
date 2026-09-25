/**
 * The sensitive media gateway.
 *
 * One function decides what happens to one attachment, and every image in the
 * application goes through it. That is the point: the rules in §5 and §7 of
 * the spec are only worth anything if there is no second path.
 *
 *   validate → consent → moderate → clear? → relevant? → afford? → describe
 *
 * Each step can only ever reduce what happens next. There is no branch that
 * re-admits content an earlier step withheld, and the failure of any step
 * leaves the attachment unread rather than unexamined-but-forwarded.
 *
 * Two properties are load-bearing:
 *
 * It fails closed. No moderation provider means no image is described - not
 * "described cautiously". An unreadable verdict, a provider error, a timeout
 * and a low-confidence verdict all land on the same outcome as an explicit
 * image: metadata only.
 *
 * A hard block is final. Explicit and suspected-illegal content is never sent
 * anywhere again, including to a second classifier "just to be sure". §7 calls
 * that out specifically as a workaround not to build, and the gateway enforces
 * it by never calling a provider after `isHardBlocked` is true.
 */

import { log } from "@/lib/logger";
import {
  MediaClassification,
  WithheldReason,
  isHardBlocked,
  mayDescribe,
  publicMediaLabel,
} from "@/lib/media/classification";
import { MessageType, type MediaAttachment } from "@/lib/model/message";
import { MediaShape, type EventMedia } from "@/lib/model/event";
import { validateAttachment, type MediaLimits } from "./policy";
import type {
  MediaPayload,
  ModerationProvider,
  VisionProvider,
} from "./providers/types";

/**
 * Confidence below which a verdict is not trusted.
 *
 * A classifier that is unsure whether a photograph is explicit has, for our
 * purposes, said it might be. Treating "probably fine" as fine is how private
 * images end up in prompts.
 */
export const MIN_MODERATION_CONFIDENCE = 0.6;

export interface GatewayDeps {
  moderation: ModerationProvider | null;
  vision: VisionProvider | null;
  /** Reads the file the attachment points at. Absent means nothing to read. */
  load: ((attachment: MediaAttachment) => Promise<MediaPayload | null>) | null;
}

export interface GatewayRequest {
  attachment: MediaAttachment;
  limits: MediaLimits;
  /** False when this participant did not consent to images being analysed. */
  consented: boolean;
  /** False when the analysis found nothing that made this worth reading. */
  relevant: boolean;
  /** False when the media allowance for this analysis is already spent. */
  affordable: boolean;
}

export interface GatewayOutcome {
  media: EventMedia;
  /**
   * Set when the gateway saw something it must not pass on. The caller stops
   * processing the rest of that owner's media and records a safety event.
   */
  halt: boolean;
}

function uiKindOf(kind: MessageType): "image" | "audio" | "document" | "video" | "other" {
  if (kind === MessageType.IMAGE) return "image";
  if (kind === MessageType.AUDIO) return "audio";
  if (kind === MessageType.FILE) return "document";
  if (kind === MessageType.VIDEO) return "video";
  return "other";
}

/** An attachment that exists and was not read, for the stated reason. */
function withheld(
  attachment: MediaAttachment,
  classification: MediaClassification,
  reason: WithheldReason,
): EventMedia {
  return {
    kind: attachment.kind,
    classification,
    description: null,
    extractedText: null,
    shape: null,
    durationSeconds: attachment.durationSeconds ?? null,
    withheld: reason,
    label: publicMediaLabel(uiKindOf(attachment.kind), reason),
  };
}

/**
 * Runs one attachment through the gateway.
 *
 * Returns what the analysis and the UI are allowed to know. Never throws: a
 * provider blowing up is an outcome (`PROVIDER_FAILED`), because §40 requires
 * the surrounding analysis to continue regardless.
 */
export async function passThroughGateway(
  request: GatewayRequest,
  deps: GatewayDeps,
): Promise<GatewayOutcome> {
  const { attachment } = request;

  // --- V3 analyses no video. Stop before any provider is involved. --------
  if (attachment.kind === MessageType.VIDEO) {
    return {
      media: withheld(
        attachment,
        MediaClassification.UNKNOWN,
        WithheldReason.NOT_SUPPORTED_IN_VERSION,
      ),
      halt: false,
    };
  }

  // --- 1. Is this a file we accept at all? -------------------------------
  const validation = validateAttachment(attachment, request.limits);
  if (!validation.ok) {
    return {
      media: withheld(
        attachment,
        MediaClassification.UNKNOWN,
        WithheldReason.UNSUPPORTED,
      ),
      halt: false,
    };
  }

  // --- 2. Consent comes before cost, because it is not negotiable. -------
  // Checked ahead of relevance and allowance on purpose: a refusal is not a
  // budgeting decision, and ordering it first means no code path can reach a
  // provider by first deciding the image was cheap enough.
  if (!request.consented) {
    return {
      media: withheld(
        attachment,
        MediaClassification.UNKNOWN,
        WithheldReason.NO_CONSENT,
      ),
      halt: false,
    };
  }

  // --- 3. Nothing is described without moderation clearing it first. -----
  if (deps.moderation === null || deps.load === null) {
    return {
      media: withheld(
        attachment,
        MediaClassification.UNKNOWN,
        WithheldReason.NOT_MODERATED,
      ),
      halt: false,
    };
  }

  let payload: MediaPayload | null;
  try {
    payload = await deps.load(attachment);
  } catch (error) {
    log.warn("media.load_failed", { reason: describe(error) });
    payload = null;
  }
  if (payload === null) {
    return {
      media: withheld(
        attachment,
        MediaClassification.UNKNOWN,
        WithheldReason.PROVIDER_FAILED,
      ),
      halt: false,
    };
  }

  const verdict = await safely(() => deps.moderation!.classify(payload!));
  if (verdict === null || verdict.ok !== true) {
    // An unreadable verdict is not permission.
    return {
      media: withheld(
        attachment,
        MediaClassification.UNKNOWN,
        WithheldReason.PROVIDER_FAILED,
      ),
      halt: false,
    };
  }

  // --- 4. The hard stop. -------------------------------------------------
  if (verdict.suspectedIllegal) {
    // Nothing about the content is recorded, logged or reported beyond the
    // fact that a message existed. No second opinion is sought.
    log.error("media.halted", { reason: "suspected_illegal_content" });
    return {
      media: withheld(
        attachment,
        MediaClassification.RESTRICTED,
        WithheldReason.SENSITIVE_CONTENT,
      ),
      halt: true,
    };
  }

  const confident =
    verdict.confidence === null || verdict.confidence >= MIN_MODERATION_CONFIDENCE;

  // A confident verdict stands; an unconfident one is downgraded to UNKNOWN,
  // which `mayDescribe` refuses. Either way the next check decides.
  const classification = confident ? verdict.classification : MediaClassification.UNKNOWN;

  if (isHardBlocked(classification)) {
    return {
      media: withheld(attachment, classification, WithheldReason.SENSITIVE_CONTENT),
      halt: false,
    };
  }

  if (!mayDescribe(classification)) {
    return {
      media: withheld(
        attachment,
        classification,
        classification === MediaClassification.UNKNOWN
          ? WithheldReason.NOT_MODERATED
          : WithheldReason.SENSITIVE_CONTENT,
      ),
      halt: false,
    };
  }

  // --- 5. Cleared. Is looking at it worth anything? ----------------------
  if (!request.relevant) {
    return {
      media: withheld(attachment, classification, WithheldReason.NOT_RELEVANT),
      halt: false,
    };
  }
  if (!request.affordable) {
    return {
      media: withheld(attachment, classification, WithheldReason.ALLOWANCE_SPENT),
      halt: false,
    };
  }
  if (deps.vision === null) {
    return {
      media: withheld(attachment, classification, WithheldReason.PROVIDER_FAILED),
      halt: false,
    };
  }

  // --- 6. Describe it. ---------------------------------------------------
  const finding = await safely(() => deps.vision!.describe(payload!));
  if (finding === null || finding.ok !== true) {
    return {
      media: withheld(attachment, classification, WithheldReason.PROVIDER_FAILED),
      halt: false,
    };
  }

  const extracted = finding.extractedText?.trim() ?? "";

  return {
    media: {
      kind: attachment.kind,
      classification,
      description: finding.description.trim() || null,
      extractedText: extracted.length > 0 ? extracted : null,
      shape: finding.shape,
      durationSeconds: attachment.durationSeconds ?? null,
      withheld: null,
      label: publicMediaLabel(uiKindOf(attachment.kind), null),
    },
    halt: false,
  };
}

/* -------------------------------------------------------------------------
 * Relevance
 * ---------------------------------------------------------------------- */

/**
 * Shapes worth reading in full even when the surrounding text is unremarkable.
 *
 * A screenshot is usually the most informative image in a conversation - it is
 * evidence someone chose to bring in. A landscape photograph next to "nice
 * weather today" is not, and §10 uses that exact pair as the example.
 */
const ALWAYS_WORTH_READING: ReadonlySet<MediaShape> = new Set([
  MediaShape.CHAT_SCREENSHOT,
  MediaShape.DOCUMENT_SCREENSHOT,
  MediaShape.SCREENSHOT,
]);

export function shapeIsHighValue(shape: MediaShape | null): boolean {
  return shape !== null && ALWAYS_WORTH_READING.has(shape);
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

/** Runs a provider call, turning any throw into null. */
async function safely<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    log.warn("media.provider_failed", { reason: describe(error) });
    return null;
  }
}

/** A provider's error, reduced to something safe to log. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.name;
  return "unknown";
}
