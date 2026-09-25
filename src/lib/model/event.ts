/**
 * The unified chronological representation every analysis reads.
 *
 * `NormalizedMessage` is what the Telegram parser produces: faithful to the
 * export, with no knowledge of transcription or media classification. A
 * `ConversationEvent` is that message *after* the media pipeline has run -
 * same message, now carrying whatever was learned about its attachments.
 *
 * Keeping the two apart matters for one reason above the rest: §8 of the spec.
 * A message is not removed because its attachment could not be analysed. An
 * explicit photograph sent with the text "look what I bought" still reaches the
 * analysis as that text plus the fact that an image was attached, and the image
 * itself goes nowhere. The event is the shape that makes that separation
 * structural rather than a rule someone has to remember.
 */

import {
  MediaClassification,
  WithheldReason,
  publicMediaLabel,
} from "@/lib/media/classification";
import {
  MessageType,
  type Conversation,
  type MediaAttachment,
  type NormalizedMessage,
} from "./message";

/**
 * What an event is, for analysis purposes.
 *
 * Coarser than `MessageType` on purpose: the parser's fidelity is needed for
 * statistics, but the analysis only cares which of these paths an event took.
 *
 * There is no VIDEO member. V3 analyses no video, and giving video its own
 * analysis-facing type would be the first half of building the pipeline this
 * version is explicitly not building. Video messages become `OTHER_MEDIA`, so
 * they are still counted, still shown and still surrounded by their own text -
 * they simply have nowhere to be analysed.
 */
export const EventType = {
  TEXT: "TEXT",
  IMAGE: "IMAGE",
  AUDIO: "AUDIO",
  DOCUMENT: "DOCUMENT",
  /** Video, stickers, locations, polls, calls: present, never analysed. */
  OTHER_MEDIA: "OTHER_MEDIA",
  SYSTEM: "SYSTEM",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export const TranscriptionStatus = {
  /** Not attempted: no provider configured, or not an audio attachment. */
  NOT_ATTEMPTED: "NOT_ATTEMPTED",
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  /** Provider ran and returned nothing - silence, or too short to hear. */
  EMPTY: "EMPTY",
  SKIPPED: "SKIPPED",
} as const;

export type TranscriptionStatus =
  (typeof TranscriptionStatus)[keyof typeof TranscriptionStatus];

export interface Transcript {
  status: TranscriptionStatus;
  /** The spoken words, when there were any. Empty for every other status. */
  text: string;
  /** BCP-47 where the provider detected one. */
  language: string | null;
  /** The provider's own confidence, 0-1, where it reports one. */
  confidence: number | null;
  /** Short internal reason for a non-completed status. Never user-facing. */
  detail: string | null;
}

/**
 * One attachment, as the analysis is allowed to see it.
 *
 * Note what is absent: no file path, no storage key, no provider name, no raw
 * moderation payload. Everything here is either safe to put in a prompt or
 * safe to put on a screen.
 */
export interface EventMedia {
  /** The parser's kind, kept for statistics and for the UI's icon. */
  kind: MessageType;
  classification: MediaClassification;
  /** Present when a vision model was allowed to look and did. */
  description: string | null;
  /**
   * Text read out of the image - a chat screenshot, a document photograph.
   * Evidence-grade: quoted in the report, so it is the participants' words
   * rather than a model's paraphrase.
   */
  extractedText: string | null;
  /** Set when the attachment looked like a screenshot, meme, and so on. */
  shape: MediaShape | null;
  durationSeconds: number | null;
  /** Why nothing deeper happened. Null when the attachment was analysed. */
  withheld: WithheldReason | null;
  /** One line a reader may see. Never contains a classification name. */
  label: string;
}

/**
 * What kind of image this is, structurally.
 *
 * Separate from classification because the two answer different questions:
 * classification decides whether we may look, shape decides whether looking is
 * worth anything. A chat screenshot is usually the most informative image in a
 * conversation; a landscape photograph almost never is.
 */
export const MediaShape = {
  SCREENSHOT: "SCREENSHOT",
  CHAT_SCREENSHOT: "CHAT_SCREENSHOT",
  DOCUMENT_SCREENSHOT: "DOCUMENT_SCREENSHOT",
  MEME: "MEME",
  ORDINARY_PHOTO: "ORDINARY_PHOTO",
} as const;

export type MediaShape = (typeof MediaShape)[keyof typeof MediaShape];

export interface ConversationEvent {
  id: string;
  senderId: string;
  senderName: string;
  timestamp: string;
  epochMs: number;
  localIso: string;
  type: EventType;
  /** The message's own words. Empty for a pure-media or service message. */
  text: string;
  replyTo: string | null;
  transcript: Transcript | null;
  media: EventMedia[];
  edited: boolean;
  forwarded: boolean;
}

/* -------------------------------------------------------------------------
 * Building events
 * ---------------------------------------------------------------------- */

/** What the media pipeline learned, keyed by message id. */
export interface EventEnrichment {
  transcripts?: ReadonlyMap<string, Transcript>;
  /** Per message, per attachment index. */
  media?: ReadonlyMap<string, readonly EventMedia[]>;
}

const IMAGE_KINDS: ReadonlySet<MessageType> = new Set([MessageType.IMAGE]);
const AUDIO_KINDS: ReadonlySet<MessageType> = new Set([MessageType.AUDIO]);
const DOCUMENT_KINDS: ReadonlySet<MessageType> = new Set([MessageType.FILE]);

/**
 * Decides an event's type from the message.
 *
 * Text wins when there is text and the attachment is not the point: a photo
 * with a caption is still an IMAGE event, but the caption is what the analysis
 * reads first. A service message is SYSTEM regardless of what it carries.
 */
export function eventTypeFor(message: NormalizedMessage): EventType {
  if (message.type === MessageType.SYSTEM) return EventType.SYSTEM;
  if (IMAGE_KINDS.has(message.type)) return EventType.IMAGE;
  if (AUDIO_KINDS.has(message.type)) return EventType.AUDIO;
  if (DOCUMENT_KINDS.has(message.type)) return EventType.DOCUMENT;
  if (message.type === MessageType.TEXT) return EventType.TEXT;
  if (message.hasMedia) return EventType.OTHER_MEDIA;
  return EventType.TEXT;
}

function uiKind(kind: MessageType): "image" | "audio" | "document" | "video" | "other" {
  if (kind === MessageType.IMAGE) return "image";
  if (kind === MessageType.AUDIO) return "audio";
  if (kind === MessageType.FILE) return "document";
  if (kind === MessageType.VIDEO) return "video";
  return "other";
}

/**
 * The default state of an attachment nothing has looked at.
 *
 * Every field that would describe content is null, and the classification is
 * UNKNOWN rather than ORDINARY - an unexamined file is not known to be safe,
 * and the difference is what makes the gateway fail closed.
 */
export function unexaminedMedia(attachment: MediaAttachment): EventMedia {
  const withheld =
    attachment.kind === MessageType.VIDEO
      ? WithheldReason.NOT_SUPPORTED_IN_VERSION
      : WithheldReason.NOT_MODERATED;

  return {
    kind: attachment.kind,
    classification: MediaClassification.UNKNOWN,
    description: null,
    extractedText: null,
    shape: null,
    durationSeconds: attachment.durationSeconds ?? null,
    withheld,
    label: publicMediaLabel(uiKind(attachment.kind), withheld),
  };
}

export function toConversationEvent(
  message: NormalizedMessage,
  enrichment: EventEnrichment = {},
): ConversationEvent {
  const media =
    enrichment.media?.get(message.id) ?? message.media.map(unexaminedMedia);

  return {
    id: message.id,
    senderId: message.senderId,
    senderName: message.senderName,
    timestamp: message.timestamp,
    epochMs: message.epochMs,
    localIso: message.localIso,
    type: eventTypeFor(message),
    text: message.text,
    replyTo: message.replyTo,
    transcript: enrichment.transcripts?.get(message.id) ?? null,
    media: [...media],
    edited: message.edited,
    forwarded: message.forwarded,
  };
}

/** The whole conversation as events, in the order it happened. */
export function toConversationEvents(
  conversation: Pick<Conversation, "messages">,
  enrichment: EventEnrichment = {},
): ConversationEvent[] {
  return conversation.messages.map((message) =>
    toConversationEvent(message, enrichment),
  );
}

/* -------------------------------------------------------------------------
 * Rendering an event for a prompt
 * ---------------------------------------------------------------------- */

/**
 * What the model reads for one event.
 *
 * This is the single place where media becomes words, and it is deliberately
 * narrow. A transcript is presented as speech, because that is what it is. A
 * description is marked as a description so the model does not quote it back
 * as though a participant had written it. An attachment nothing looked at
 * contributes a bare fact - that it was there - because that fact still
 * changes how the surrounding text reads.
 *
 * No internal identifier, classification name or provider appears in the
 * output, so nothing here can leak into a report by accident.
 */
export function renderEventContent(event: ConversationEvent): string {
  const parts: string[] = [];

  if (event.text.trim().length > 0) parts.push(event.text.trim());

  if (event.transcript?.status === TranscriptionStatus.COMPLETED) {
    const spoken = event.transcript.text.trim();
    if (spoken.length > 0) parts.push(`(voice message, transcribed) ${spoken}`);
  } else if (event.type === EventType.AUDIO) {
    const seconds = event.media[0]?.durationSeconds;
    const length = seconds !== null && seconds !== undefined ? `, ${Math.round(seconds)}s` : "";
    parts.push(`(voice message${length}, no transcript available)`);
  }

  for (const attachment of event.media) {
    if (attachment.kind === MessageType.AUDIO) continue; // handled above
    const rendered = renderAttachment(attachment);
    if (rendered !== null) parts.push(rendered);
  }

  return parts.join(" ").trim();
}

function renderAttachment(attachment: EventMedia): string | null {
  if (attachment.extractedText !== null && attachment.extractedText.trim().length > 0) {
    const shape =
      attachment.shape === MediaShape.CHAT_SCREENSHOT
        ? "screenshot of a conversation"
        : attachment.shape === MediaShape.DOCUMENT_SCREENSHOT
          ? "photograph of a document"
          : "screenshot";
    return `(${shape}, text read from it) ${attachment.extractedText.trim()}`;
  }

  if (attachment.description !== null && attachment.description.trim().length > 0) {
    return `(image, described) ${attachment.description.trim()}`;
  }

  switch (attachment.kind) {
    case MessageType.IMAGE:
      return "(image attached, contents not analyzed)";
    case MessageType.VIDEO:
      return "(video attached, not analyzed)";
    case MessageType.FILE:
      return "(file attached, contents not analyzed)";
    case MessageType.STICKER:
      return "(sticker)";
    default:
      return null;
  }
}
