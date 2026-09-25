/**
 * What an attachment is, as far as safety and routing are concerned.
 *
 * These are internal labels. They decide whether a file may be described, and
 * by what, and they are never shown to a user - §7 of the spec is explicit
 * about that, and §39 repeats it for the UI: nobody should read
 * "SEXUAL_EXPLICIT" next to a photograph they sent someone they love.
 *
 * The UI gets `publicMediaLabel()` instead, which says only what a reader
 * needs: that an image exists, and whether it was looked at.
 */

export const MediaClassification = {
  /** Safe to describe with a cheap vision model. */
  ORDINARY: "ORDINARY",
  /** Private or intimate without being explicit. Not described by default. */
  SENSITIVE: "SENSITIVE",
  /** Suggestive rather than explicit. Not described by default. */
  SEXUAL_SUGGESTIVE: "SEXUAL_SUGGESTIVE",
  /** Never sent to any analysis model. Metadata only. */
  SEXUAL_EXPLICIT: "SEXUAL_EXPLICIT",
  VIOLENT: "VIOLENT",
  GRAPHIC: "GRAPHIC",
  /** Passports, bank statements, medical letters. Metadata only. */
  PERSONAL_DOCUMENT: "PERSONAL_DOCUMENT",
  /** Moderation could not reach a conclusion, or never ran. Fails closed. */
  UNKNOWN: "UNKNOWN",
  /**
   * A hard stop. Set when content is suspected to be illegal. Nothing further
   * happens to the file: it is not described, not classified again, not
   * forwarded to any provider, and not represented in any report beyond the
   * fact that the message existed.
   */
  RESTRICTED: "RESTRICTED",
} as const;

export type MediaClassification =
  (typeof MediaClassification)[keyof typeof MediaClassification];

/** Classifications that may be handed to a vision model for description. */
const DESCRIBABLE: ReadonlySet<MediaClassification> = new Set([
  MediaClassification.ORDINARY,
]);

/**
 * Classifications that must never reach any analysis provider, for any
 * purpose, including a second classification pass.
 */
const HARD_BLOCKED: ReadonlySet<MediaClassification> = new Set([
  MediaClassification.SEXUAL_EXPLICIT,
  MediaClassification.RESTRICTED,
]);

export function mayDescribe(classification: MediaClassification): boolean {
  return DESCRIBABLE.has(classification);
}

/**
 * True when the file must not be sent anywhere, ever.
 *
 * Distinct from `!mayDescribe`: a SENSITIVE image is not described by default
 * but could be if the analysis genuinely needed it and the owner asked. A
 * hard-blocked one could not, under any circumstance.
 */
export function isHardBlocked(classification: MediaClassification): boolean {
  return HARD_BLOCKED.has(classification);
}

/** Why an attachment was not described. Internal; drives the UI's wording. */
export const WithheldReason = {
  /** Classified as something that is not described. */
  SENSITIVE_CONTENT: "SENSITIVE_CONTENT",
  /** No moderation provider is configured, so nothing was cleared. */
  NOT_MODERATED: "NOT_MODERATED",
  /** Cleared, but nothing in the conversation made it worth reading. */
  NOT_RELEVANT: "NOT_RELEVANT",
  /** Cleared and relevant, but the allowance for this analysis was spent. */
  ALLOWANCE_SPENT: "ALLOWANCE_SPENT",
  /** The file itself was rejected: wrong type, too large, too long. */
  UNSUPPORTED: "UNSUPPORTED",
  /** A provider failed. The message survives; the attachment is unread. */
  PROVIDER_FAILED: "PROVIDER_FAILED",
  /** The participant did not consent to this content type being analysed. */
  NO_CONSENT: "NO_CONSENT",
  /** V3 analyses no video. Present so the message is still represented. */
  NOT_SUPPORTED_IN_VERSION: "NOT_SUPPORTED_IN_VERSION",
} as const;

export type WithheldReason = (typeof WithheldReason)[keyof typeof WithheldReason];

/**
 * What a reader sees in place of an internal classification.
 *
 * Deliberately vague about *why* something was not analysed when the reason is
 * the content itself: "Private image" tells the owner what they need without
 * the application announcing a verdict on a photograph.
 */
export function publicMediaLabel(
  kind: "image" | "audio" | "document" | "video" | "other",
  reason: WithheldReason | null,
): string {
  const noun =
    kind === "image"
      ? "Image"
      : kind === "audio"
        ? "Voice message"
        : kind === "document"
          ? "Document"
          : kind === "video"
            ? "Video"
            : "Attachment";

  if (reason === null) return noun;

  switch (reason) {
    case WithheldReason.SENSITIVE_CONTENT:
      return `Private ${noun.toLowerCase()} — not analyzed`;
    case WithheldReason.NO_CONSENT:
      return `${noun} — not covered by consent`;
    case WithheldReason.NOT_RELEVANT:
      return `${noun} — no analysis needed`;
    case WithheldReason.ALLOWANCE_SPENT:
      return `${noun} — beyond this analysis's media allowance`;
    case WithheldReason.UNSUPPORTED:
    case WithheldReason.NOT_SUPPORTED_IN_VERSION:
      return `${noun} — not analyzed`;
    case WithheldReason.PROVIDER_FAILED:
      return `${noun} — analysis unavailable`;
    case WithheldReason.NOT_MODERATED:
      return `${noun} — not analyzed`;
    default:
      return noun;
  }
}
