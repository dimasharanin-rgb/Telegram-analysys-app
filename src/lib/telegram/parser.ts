/**
 * Telegram Desktop JSON export parser.
 *
 * Handles the two shapes Telegram Desktop actually produces:
 *   1. a single chat export - `{ name, type, id, messages: [...] }`
 *   2. a full account export - `{ chats: { list: [ <single chat>, ... ] } }`
 *
 * Nothing about a message is assumed: `text` may be a string, an array of
 * mixed strings and entity objects, or absent entirely; `from` may be missing;
 * timestamps may or may not carry `*_unixtime`. Anything that cannot be
 * understood is counted and skipped rather than throwing.
 */

import { z } from "zod";
import { AppError } from "@/lib/errors";
import {
  MessageType,
  type ChatSummary,
  type Conversation,
  type MediaAttachment,
  type MessageReaction,
  type NormalizedMessage,
  type ParseWarning,
  type Participant,
} from "@/lib/model/message";

/* -------------------------------------------------------------------------
 * Root shape validation
 * ---------------------------------------------------------------------- */

const rootChatSchema = z.object({
  name: z.unknown().optional(),
  type: z.unknown().optional(),
  id: z.unknown().optional(),
  messages: z.array(z.unknown()),
});

const rootAccountSchema = z.object({
  chats: z.object({
    list: z.array(z.unknown()),
  }),
});

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/* -------------------------------------------------------------------------
 * Text flattening
 * ---------------------------------------------------------------------- */

/**
 * Turns Telegram's `text` / `text_entities` into plain text.
 *
 * `text_entities` is preferred because it is always an array of
 * `{ type, text }` objects; `text` is the legacy field and may be a bare
 * string, an array, or a mixture.
 */
export function flattenText(message: RawRecord): string {
  const entities = message.text_entities;
  if (Array.isArray(entities) && entities.length > 0) {
    const joined = entities
      .map((entity) => (isRecord(entity) ? (str(entity.text) ?? "") : (str(entity) ?? "")))
      .join("");
    if (joined.trim().length > 0) return joined.trim();
  }

  const text = message.text;
  if (typeof text === "string") return text.trim();
  if (Array.isArray(text)) {
    return text
      .map((part) => {
        if (typeof part === "string") return part;
        if (isRecord(part)) return str(part.text) ?? "";
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

/* -------------------------------------------------------------------------
 * Time handling
 * ---------------------------------------------------------------------- */

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;

/** Parses Telegram's naive `YYYY-MM-DDTHH:mm:ss` as if it were UTC. */
function parseWallClockAsUtc(value: string): number | null {
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
  return Number.isFinite(ms) ? ms : null;
}

function normaliseWallClock(value: string): string | null {
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

function unixSeconds(value: unknown): number | null {
  const raw = str(value);
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * Derives the exporter's UTC offset by comparing the naive wall clock against
 * the absolute `date_unixtime`, which Telegram includes in current exports.
 * Returns null for older exports that only carry the wall clock.
 */
export function deriveTimezoneOffsetMinutes(messages: unknown[]): number | null {
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const date = str(message.date);
    const unix = unixSeconds(message.date_unixtime);
    if (!date || unix === null) continue;
    const wall = parseWallClockAsUtc(date);
    if (wall === null) continue;
    const offset = Math.round((wall - unix * 1000) / 60_000);
    // Real offsets sit between -12:00 and +14:00.
    if (offset >= -720 && offset <= 840) return offset;
  }
  return null;
}

/* -------------------------------------------------------------------------
 * Media / type classification
 * ---------------------------------------------------------------------- */

const MEDIA_TYPE_MAP: Record<string, MessageType> = {
  sticker: MessageType.STICKER,
  voice_message: MessageType.AUDIO,
  audio_file: MessageType.AUDIO,
  video_file: MessageType.VIDEO,
  video_message: MessageType.VIDEO,
  animation: MessageType.VIDEO,
};

/** True for Telegram's "(File not included ...)" placeholders. */
function isMediaReference(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function classify(message: RawRecord): { type: MessageType; media: MediaAttachment[] } {
  const media: MediaAttachment[] = [];

  const mediaTypeRaw = str(message.media_type);
  const mapped = mediaTypeRaw ? MEDIA_TYPE_MAP[mediaTypeRaw] : undefined;

  if (mapped) {
    media.push({
      kind: mapped,
      ...(str(message.mime_type) ? { mimeType: str(message.mime_type)! } : {}),
      ...(typeof message.duration_seconds === "number"
        ? { durationSeconds: message.duration_seconds }
        : {}),
      ...(isMediaReference(message.file) ? { reference: String(message.file) } : {}),
      ...(typeof message.file_size === "number" && message.file_size >= 0
        ? { sizeBytes: message.file_size }
        : {}),
      ...(str(message.sticker_emoji) ? { label: str(message.sticker_emoji)! } : {}),
    });
  } else if (isMediaReference(message.photo)) {
    media.push({
      kind: MessageType.IMAGE,
      reference: String(message.photo),
      // Telegram labels a photo by extension rather than mime type; the
      // media policy needs one to validate against.
      mimeType: "image/jpeg",
      ...(typeof message.file_size === "number" && message.file_size >= 0
        ? { sizeBytes: message.file_size }
        : {}),
    });
  } else if (isMediaReference(message.file)) {
    media.push({
      kind: MessageType.FILE,
      reference: String(message.file),
      ...(str(message.mime_type) ? { mimeType: str(message.mime_type)! } : {}),
      ...(typeof message.file_size === "number" && message.file_size >= 0
        ? { sizeBytes: message.file_size }
        : {}),
      ...(str(message.file_name) ? { label: str(message.file_name)! } : {}),
    });
  }

  if (media.length > 0) return { type: media[0]!.kind, media };

  if (isRecord(message.location_information)) {
    return {
      type: MessageType.LOCATION,
      media: [{ kind: MessageType.LOCATION }],
    };
  }
  if (isRecord(message.contact_information) || isMediaReference(message.contact_vcard)) {
    return {
      type: MessageType.CONTACT,
      media: [{ kind: MessageType.CONTACT }],
    };
  }
  if (isRecord(message.poll)) {
    const question = isRecord(message.poll) ? str(message.poll.question) : undefined;
    return {
      type: MessageType.POLL,
      media: [
        { kind: MessageType.POLL, ...(question ? { label: question } : {}) },
      ],
    };
  }

  return { type: MessageType.TEXT, media: [] };
}

function parseReactions(value: unknown): MessageReaction[] {
  if (!Array.isArray(value)) return [];
  const reactions: MessageReaction[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const emoji = str(entry.emoji) ?? str(entry.document_id) ?? "reaction";
    const count = typeof entry.count === "number" ? entry.count : 1;
    const recent = Array.isArray(entry.recent) ? entry.recent : [];
    const fromIds = recent
      .map((r) => (isRecord(r) ? str(r.from_id) : undefined))
      .filter((id): id is string => Boolean(id));
    reactions.push({ emoji, count, fromIds });
  }
  return reactions;
}

/* -------------------------------------------------------------------------
 * Message normalisation
 * ---------------------------------------------------------------------- */

interface NormaliseContext {
  offsetMinutes: number | null;
}

function normaliseMessage(
  raw: unknown,
  context: NormaliseContext,
): NormalizedMessage | null {
  if (!isRecord(raw)) return null;

  const id = str(raw.id);
  const dateRaw = str(raw.date);
  if (!id || !dateRaw) return null;

  const localIso = normaliseWallClock(dateRaw);
  if (!localIso) return null;

  const wallAsUtc = parseWallClockAsUtc(dateRaw);
  if (wallAsUtc === null) return null;

  const unix = unixSeconds(raw.date_unixtime);
  const offset = context.offsetMinutes;
  const epochMs = unix !== null ? unix * 1000 : wallAsUtc - (offset ?? 0) * 60_000;

  const timestamp =
    offset === null ? localIso : `${localIso}${formatOffset(offset)}`;

  const isService = str(raw.type) === "service";
  const senderId =
    str(raw.from_id) ?? str(raw.actor_id) ?? (isService ? "system" : undefined);
  const senderName = str(raw.from) ?? str(raw.actor) ?? senderId;

  if (!senderId || !senderName) return null;

  const text = flattenText(raw);
  const reactions = parseReactions(raw.reactions);
  const editedAt = str(raw.edited);

  let type: MessageType;
  let media: MediaAttachment[] = [];

  if (isService) {
    const action = str(raw.action);
    type = action === "phone_call" ? MessageType.CALL : MessageType.SYSTEM;
  } else {
    const classified = classify(raw);
    type = classified.type;
    media = classified.media;
    // A media message that also carries a caption stays a media message; a
    // bare TEXT classification with no text at all is not usable.
    if (type === MessageType.TEXT && text.length === 0) {
      type = MessageType.UNKNOWN;
    }
  }

  return {
    id,
    timestamp,
    epochMs,
    localIso,
    senderId,
    senderName,
    text,
    replyTo: str(raw.reply_to_message_id) ?? null,
    type,
    hasMedia: media.length > 0,
    media,
    reactions,
    edited: Boolean(editedAt),
    ...(editedAt ? { editedAt } : {}),
    forwarded: Boolean(str(raw.forwarded_from)),
  };
}

/* -------------------------------------------------------------------------
 * Public API
 * ---------------------------------------------------------------------- */

export interface ParseOptions {
  /** Which chat to take from a full account export. Defaults to the largest. */
  chatId?: string;
}

function chatSummary(chat: unknown, index: number): ChatSummary | null {
  if (!isRecord(chat)) return null;
  const messages = Array.isArray(chat.messages) ? chat.messages : null;
  if (!messages) return null;
  return {
    id: str(chat.id) ?? `chat-${index}`,
    name: str(chat.name) ?? "Untitled chat",
    type: str(chat.type) ?? "unknown",
    messageCount: messages.length,
  };
}

/** Parses raw export text, converting JSON syntax errors into an AppError. */
export function parseTelegramExportText(
  text: string,
  options: ParseOptions = {},
): Conversation {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AppError("INVALID_JSON");
  }
  return parseTelegramExport(data, options);
}

export function parseTelegramExport(
  data: unknown,
  options: ParseOptions = {},
): Conversation {
  const warnings: ParseWarning[] = [];

  // Locate the chat object we are going to read.
  let chat: RawRecord;
  let availableChats: ChatSummary[] = [];

  const account = rootAccountSchema.safeParse(data);
  if (account.success) {
    const list = account.data.chats.list;
    availableChats = list
      .map((entry, index) => chatSummary(entry, index))
      .filter((entry): entry is ChatSummary => entry !== null)
      .sort((a, b) => b.messageCount - a.messageCount);

    if (availableChats.length === 0) throw new AppError("UNSUPPORTED_EXPORT");

    const wanted = options.chatId
      ? list.find(
          (entry, index) =>
            isRecord(entry) && (str(entry.id) ?? `chat-${index}`) === options.chatId,
        )
      : undefined;

    const chosen =
      wanted ??
      list
        .filter(isRecord)
        .reduce<RawRecord | null>((best, entry) => {
          const size = Array.isArray(entry.messages) ? entry.messages.length : -1;
          const bestSize =
            best && Array.isArray(best.messages) ? best.messages.length : -1;
          return size > bestSize ? entry : best;
        }, null);

    if (!chosen || !isRecord(chosen)) throw new AppError("UNSUPPORTED_EXPORT");
    chat = chosen;

    if (availableChats.length > 1) {
      warnings.push({
        code: "MULTIPLE_CHATS",
        message: `This file contains ${availableChats.length} chats. Analysing "${str(chosen.name) ?? "the largest chat"}".`,
        count: availableChats.length,
      });
    }
  } else {
    const single = rootChatSchema.safeParse(data);
    if (!single.success) throw new AppError("UNSUPPORTED_EXPORT");
    chat = data as RawRecord;
  }

  const rawMessages = Array.isArray(chat.messages) ? chat.messages : [];
  if (rawMessages.length === 0) throw new AppError("EMPTY_CONVERSATION");

  const offsetMinutes = deriveTimezoneOffsetMinutes(rawMessages);
  if (offsetMinutes === null) {
    warnings.push({
      code: "MISSING_TIMEZONE",
      message:
        "This export has no timezone information. Times are read exactly as written in the file.",
    });
  }

  const messages: NormalizedMessage[] = [];
  let unparseable = 0;

  for (const raw of rawMessages) {
    let normalised: NormalizedMessage | null = null;
    try {
      normalised = normaliseMessage(raw, { offsetMinutes });
    } catch {
      normalised = null;
    }
    if (normalised === null) {
      unparseable += 1;
      continue;
    }
    messages.push(normalised);
  }

  messages.sort((a, b) => a.epochMs - b.epochMs || Number(a.id) - Number(b.id));

  const conversational = messages.filter(
    (message) =>
      message.type !== MessageType.SYSTEM &&
      message.type !== MessageType.UNKNOWN &&
      message.type !== MessageType.CALL,
  );
  const systemCount = messages.length - conversational.length;
  const withMedia = conversational.filter((message) => message.hasMedia).length;

  if (conversational.length === 0) throw new AppError("EMPTY_CONVERSATION");

  const byParticipant = new Map<string, Participant>();
  for (const message of conversational) {
    const existing = byParticipant.get(message.senderId);
    if (existing) {
      existing.messageCount += 1;
      // Telegram can change a display name mid-export; keep the latest.
      existing.name = message.senderName;
    } else {
      byParticipant.set(message.senderId, {
        id: message.senderId,
        name: message.senderName,
        messageCount: 1,
      });
    }
  }

  const participants = [...byParticipant.values()].sort(
    (a, b) => b.messageCount - a.messageCount,
  );

  if (participants.length < 2) throw new AppError("SINGLE_PARTICIPANT");

  if (participants.length > 2) {
    warnings.push({
      code: "GROUP_CHAT",
      message: `This is a group chat with ${participants.length} participants. Comparisons focus on the two most active people.`,
      count: participants.length,
    });
  }
  if (systemCount > 0) {
    warnings.push({
      code: "SKIPPED_SERVICE_MESSAGES",
      message: `${systemCount} service messages (calls, joins, pinned messages) were excluded from the statistics.`,
      count: systemCount,
    });
  }
  if (withMedia > 0) {
    warnings.push({
      code: "MEDIA_NOT_ANALYSED",
      message: `${withMedia} messages contain photos, voice notes, videos or stickers. The MVP counts them but does not analyse their contents.`,
      count: withMedia,
    });
  }
  if (unparseable > 0) {
    warnings.push({
      code: "UNPARSEABLE_MESSAGES",
      message: `${unparseable} entries could not be read and were skipped.`,
      count: unparseable,
    });
  }

  return {
    source: "telegram-desktop-json",
    chatId: str(chat.id) ?? "unknown",
    chatName: str(chat.name) ?? "Telegram chat",
    chatType: str(chat.type) ?? "unknown",
    participants,
    messages: conversational,
    timezoneOffsetMinutes: offsetMinutes,
    counts: {
      total: rawMessages.length,
      conversational: conversational.length,
      system: systemCount,
      withMedia,
      unparseable,
    },
    warnings,
    availableChats,
  };
}
