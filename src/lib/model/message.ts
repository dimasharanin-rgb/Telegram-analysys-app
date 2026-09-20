/**
 * The internal conversation model.
 *
 * This is deliberately source-agnostic: the Telegram parser is one producer,
 * and the shape is already wide enough to describe image, audio, video,
 * sticker and reaction content so that adding media analysis later is a new
 * processor rather than a new data model.
 */

/**
 * What a message primarily *is*. Media kinds are recognised and preserved in
 * the MVP even though nothing analyses their contents yet.
 */
export const MessageType = {
  TEXT: "TEXT",
  IMAGE: "IMAGE",
  AUDIO: "AUDIO",
  VIDEO: "VIDEO",
  STICKER: "STICKER",
  REACTION: "REACTION",
  FILE: "FILE",
  LOCATION: "LOCATION",
  CONTACT: "CONTACT",
  POLL: "POLL",
  CALL: "CALL",
  /** Joins, pins, title changes - excluded from most statistics. */
  SYSTEM: "SYSTEM",
  UNKNOWN: "UNKNOWN",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Message types that carry a human-authored utterance. */
export const CONVERSATIONAL_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.TEXT,
  MessageType.IMAGE,
  MessageType.AUDIO,
  MessageType.VIDEO,
  MessageType.STICKER,
  MessageType.FILE,
  MessageType.LOCATION,
  MessageType.CONTACT,
  MessageType.POLL,
]);

export const MEDIA_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.IMAGE,
  MessageType.AUDIO,
  MessageType.VIDEO,
  MessageType.STICKER,
  MessageType.FILE,
]);

/**
 * A media attachment. `analysis` is always null in the MVP; a future
 * ImageProcessor / AudioProcessor / VideoProcessor fills it in without any
 * change to the surrounding model.
 */
export interface MediaAttachment {
  kind: MessageType;
  mimeType?: string;
  durationSeconds?: number;
  /** Relative path inside the export; never read from disk in the MVP. */
  reference?: string;
  /** Sticker emoji, poll question, contact name - a short non-sensitive label. */
  label?: string;
  analysis: MediaAnalysis | null;
}

/** Output slot reserved for future media processors. */
export interface MediaAnalysis {
  processor: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  producedAt: string;
}

/** An emoji reaction attached to a message. */
export interface MessageReaction {
  emoji: string;
  count: number;
  /** Sender ids where the export records them. */
  fromIds: string[];
}

/**
 * One normalised message.
 *
 * Time is stored three ways on purpose:
 *  - `timestamp` keeps the original instant, with an explicit UTC offset when
 *    the export lets us derive one.
 *  - `epochMs` is used for every duration calculation (response times, gaps).
 *  - `localIso` is the exporter's wall clock, used for "what hour of the day"
 *    and "which weekday" statistics so they read the way the participants
 *    actually experienced them.
 */
export interface NormalizedMessage {
  id: string;
  /** ISO-8601, with offset when derivable from the export. */
  timestamp: string;
  /** Absolute time in milliseconds since the epoch. */
  epochMs: number;
  /** Wall-clock time in the export's own timezone, `YYYY-MM-DDTHH:mm:ss`. */
  localIso: string;
  senderId: string;
  senderName: string;
  /** Flattened plain text. Empty string for pure-media or service messages. */
  text: string;
  replyTo: string | null;
  type: MessageType;
  hasMedia: boolean;
  media: MediaAttachment[];
  reactions: MessageReaction[];
  edited: boolean;
  editedAt?: string;
  forwarded: boolean;
}

export interface Participant {
  id: string;
  name: string;
  messageCount: number;
}

export type ParseWarningCode =
  | "MULTIPLE_CHATS"
  | "SKIPPED_SERVICE_MESSAGES"
  | "MEDIA_NOT_ANALYSED"
  | "MISSING_TIMEZONE"
  | "UNPARSEABLE_MESSAGES"
  | "GROUP_CHAT";

export interface ParseWarning {
  code: ParseWarningCode;
  message: string;
  count?: number;
}

export interface ChatSummary {
  id: string;
  name: string;
  type: string;
  messageCount: number;
}

export interface Conversation {
  source: "telegram-desktop-json";
  chatId: string;
  chatName: string;
  chatType: string;
  participants: Participant[];
  /** Chronologically ordered. */
  messages: NormalizedMessage[];
  /**
   * Offset in minutes that the export's wall clock sits at relative to UTC,
   * or null when the export gave us no way to tell.
   */
  timezoneOffsetMinutes: number | null;
  counts: {
    total: number;
    conversational: number;
    system: number;
    withMedia: number;
    unparseable: number;
  };
  warnings: ParseWarning[];
  /** Other chats present in the same file, when it was a full account export. */
  availableChats: ChatSummary[];
}

/** Placeholder text used wherever a media message has to be represented. */
export const MEDIA_PLACEHOLDER =
  "This message contains media that is not analyzed in the MVP.";
