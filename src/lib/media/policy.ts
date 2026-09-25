/**
 * What media an analysis may process, and what it would cost.
 *
 * Media is the easiest way to make this product expensive: a chat with two
 * thousand photos would, processed naively, cost more than every text
 * analysis the account has ever run. So nothing is processed because it
 * exists. It is processed because it was selected, within a budget, after
 * the cost was estimated and shown.
 *
 * Three separate jobs, kept apart on purpose:
 *   - `validateAttachment` decides whether a file is *allowed* (type, size,
 *     duration). This is a safety check and runs on untrusted input.
 *   - `selectMedia` decides which of the allowed files are *worth* reading.
 *   - `estimateUsage` says what the selection would cost, before it runs.
 *
 * The processors that would do the reading live behind `MediaProcessor`;
 * this module decides what to hand them.
 */

import {
  MessageType,
  type MediaAttachment,
  type NormalizedMessage,
} from "@/lib/model/message";

/* -------------------------------------------------------------------------
 * Categories
 * ---------------------------------------------------------------------- */

export const MEDIA_CATEGORIES = [
  "image",
  "voice",
  "audio",
  "video",
  "document",
  "sticker",
] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

/**
 * A voice note is not an audio file.
 *
 * They are the same bytes to a transcriber and completely different things
 * to a reader: a voice note is an utterance in the conversation, an audio
 * file is usually something shared. Only the first is worth transcribing by
 * default, so the model distinguishes them.
 */
export function categoryOf(attachment: MediaAttachment): MediaCategory | null {
  switch (attachment.kind) {
    case MessageType.IMAGE:
      return "image";
    case MessageType.STICKER:
      return "sticker";
    case MessageType.VIDEO:
      return "video";
    case MessageType.AUDIO:
      // Telegram marks voice notes with an audio/ogg mime type; a shared
      // track is mp3/m4a. Duration alone is not enough to tell them apart.
      return attachment.mimeType?.includes("ogg") ? "voice" : "audio";
    case MessageType.FILE:
      return "document";
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------
 * Limits
 * ---------------------------------------------------------------------- */

export interface MediaLimits {
  maxImages: number;
  maxVideos: number;
  /** Total transcription budget across voice notes and audio files. */
  maxAudioSeconds: number;
  maxVideoSeconds: number;
  /** Refused outright above this, whatever the budget says. */
  maxFileBytes: number;
  maxVideoDurationSeconds: number;
}

function num(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/** The ceiling this deployment will process for anyone. */
export function mediaLimits(): MediaLimits {
  return {
    maxImages: num(process.env.MEDIA_MAX_IMAGES, 40),
    maxVideos: num(process.env.MEDIA_MAX_VIDEOS, 5),
    maxAudioSeconds: num(process.env.MEDIA_MAX_AUDIO_SECONDS, 1_800),
    maxVideoSeconds: num(process.env.MEDIA_MAX_VIDEO_SECONDS, 600),
    maxFileBytes: num(process.env.MEDIA_MAX_FILE_MB, 25) * 1024 * 1024,
    maxVideoDurationSeconds: num(process.env.MEDIA_MAX_VIDEO_DURATION_SECONDS, 300),
  };
}

/**
 * What a product includes.
 *
 * The text products include no media at all: someone who bought a text
 * analysis has not paid to have their photographs opened, and defaulting them
 * in would be both a cost and a privacy surprise. `multimodal` takes the
 * configured ceilings.
 *
 * Video is zero everywhere. V3 analyses none, and a video attachment fails
 * validation before any limit is consulted - the zeros are belt and braces.
 */
const PRODUCT_MEDIA: Record<string, Partial<MediaLimits>> = {
  free: { maxImages: 0, maxVideos: 0, maxAudioSeconds: 0, maxVideoSeconds: 0 },
  "deep-text": { maxImages: 0, maxVideos: 0, maxAudioSeconds: 0, maxVideoSeconds: 0 },
  "pro-credits": { maxImages: 0, maxVideos: 0, maxAudioSeconds: 0, maxVideoSeconds: 0 },
  multimodal: { maxVideos: 0, maxVideoSeconds: 0 },
};

export function mediaLimitsFor(productId: string): MediaLimits {
  return { ...mediaLimits(), ...(PRODUCT_MEDIA[productId] ?? PRODUCT_MEDIA.free) };
}

/* -------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------- */

/**
 * Mime types a provider can actually read.
 *
 * Exact types rather than `image/` and `audio/` prefixes. A prefix list looks
 * more permissive and is in fact worse: a TIFF would pass validation, be read
 * off disk and be uploaded to a moderation service before anything discovered
 * that no provider can decode it. Refusing it here means the bytes never move.
 */
const ACCEPTED_TYPES: Record<MediaCategory, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  voice: [
    "audio/ogg",
    "audio/opus",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/flac",
  ],
  get audio(): readonly string[] {
    return this.voice;
  },
  // V3 analyses no video. The list is empty rather than absent so a video
  // attachment is still described by the model and still counted - it simply
  // never validates for processing.
  video: [],
  document: ["application/pdf"],
  sticker: ["image/webp", "image/png"],
};

export type RejectionReason =
  | "unsupported-kind"
  | "unsupported-type"
  | "too-large"
  | "too-long"
  | "no-reference";

export interface Validation {
  ok: boolean;
  category: MediaCategory | null;
  reason?: RejectionReason;
}

/**
 * Whether this attachment could be processed at all.
 *
 * Runs against an untrusted export, so it checks the declared type against
 * an allow-list rather than a deny-list, and treats a missing type as
 * unsupported rather than assuming.
 */
export function validateAttachment(
  attachment: MediaAttachment,
  limits: MediaLimits = mediaLimits(),
): Validation {
  const category = categoryOf(attachment);
  if (category === null) return { ok: false, category, reason: "unsupported-kind" };

  // Nothing to read without a file to read it from.
  if (!attachment.reference) {
    return { ok: false, category, reason: "no-reference" };
  }

  // Parameters like `; codecs=opus` are part of a real Telegram export's mime
  // strings, so compare the type alone.
  const mime = (attachment.mimeType?.toLowerCase().split(";")[0] ?? "").trim();
  if (!ACCEPTED_TYPES[category].includes(mime)) {
    return { ok: false, category, reason: "unsupported-type" };
  }

  if ((attachment.sizeBytes ?? 0) > limits.maxFileBytes) {
    return { ok: false, category, reason: "too-large" };
  }

  if (
    category === "video" &&
    (attachment.durationSeconds ?? 0) > limits.maxVideoDurationSeconds
  ) {
    return { ok: false, category, reason: "too-long" };
  }

  return { ok: true, category };
}

/* -------------------------------------------------------------------------
 * Usage and cost
 * ---------------------------------------------------------------------- */

export interface MediaUsage {
  imagesProcessed: number;
  audioSeconds: number;
  videoSeconds: number;
  /** Micro-dollars, matching how token spend is recorded. */
  estimatedCostMicros: number;
}

export const EMPTY_USAGE: MediaUsage = {
  imagesProcessed: 0,
  audioSeconds: 0,
  videoSeconds: 0,
  estimatedCostMicros: 0,
};

export interface MediaPrices {
  perImageMicros: number;
  perAudioMinuteMicros: number;
  perVideoMinuteMicros: number;
}

export function mediaPrices(): MediaPrices {
  return {
    perImageMicros: num(process.env.MEDIA_PRICE_IMAGE_MICROS, 4_000),
    perAudioMinuteMicros: num(process.env.MEDIA_PRICE_AUDIO_MINUTE_MICROS, 6_000),
    perVideoMinuteMicros: num(process.env.MEDIA_PRICE_VIDEO_MINUTE_MICROS, 50_000),
  };
}

export interface SelectedMedia {
  messageId: string;
  category: MediaCategory;
  attachment: MediaAttachment;
}

/** What this selection would cost, before any of it runs. */
export function estimateUsage(
  selection: readonly SelectedMedia[],
  prices: MediaPrices = mediaPrices(),
): MediaUsage {
  let images = 0;
  let audioSeconds = 0;
  let videoSeconds = 0;

  for (const entry of selection) {
    const duration = entry.attachment.durationSeconds ?? 0;
    if (entry.category === "image" || entry.category === "sticker") images += 1;
    else if (entry.category === "voice" || entry.category === "audio") {
      audioSeconds += duration;
    } else if (entry.category === "video") videoSeconds += duration;
  }

  return {
    imagesProcessed: images,
    audioSeconds,
    videoSeconds,
    estimatedCostMicros: Math.round(
      images * prices.perImageMicros +
        (audioSeconds / 60) * prices.perAudioMinuteMicros +
        (videoSeconds / 60) * prices.perVideoMinuteMicros,
    ),
  };
}

export interface LimitCheck {
  withinLimits: boolean;
  exceeded: ("images" | "videos" | "audioSeconds" | "videoSeconds")[];
}

export function checkUsage(
  usage: MediaUsage,
  videos: number,
  limits: MediaLimits,
): LimitCheck {
  const exceeded: LimitCheck["exceeded"] = [];
  if (usage.imagesProcessed > limits.maxImages) exceeded.push("images");
  if (videos > limits.maxVideos) exceeded.push("videos");
  if (usage.audioSeconds > limits.maxAudioSeconds) exceeded.push("audioSeconds");
  if (usage.videoSeconds > limits.maxVideoSeconds) exceeded.push("videoSeconds");
  return { withinLimits: exceeded.length === 0, exceeded };
}

/* -------------------------------------------------------------------------
 * Relevance
 * ---------------------------------------------------------------------- */

/** Minutes either side of a media message that count as "the same moment". */
const CONTEXT_WINDOW_MINUTES = 5;

/**
 * How much a piece of media is worth reading.
 *
 * The signal is conversational, not visual: an image somebody commented on
 * is part of an exchange, and an image sent into silence usually is not. A
 * processor could tell you what is in every photo; what the analysis needs
 * is the few that the conversation itself treated as significant.
 */
export function relevanceScore(
  messages: readonly NormalizedMessage[],
  index: number,
): number {
  const message = messages[index];
  if (!message) return 0;

  let score = 0;
  const windowMs = CONTEXT_WINDOW_MINUTES * 60_000;

  // A caption is the sender telling you the image matters.
  if (message.text.trim().length > 0) score += 3;

  // Someone replying to it, or talking right after it, is stronger still.
  const next = messages[index + 1];
  if (next && next.epochMs - message.epochMs <= windowMs) {
    score += next.senderId === message.senderId ? 1 : 3;
    if (next.replyTo === message.id) score += 2;
  }

  const previous = messages[index - 1];
  if (previous && message.epochMs - previous.epochMs <= windowMs) {
    if (previous.text.trim().length > 0) score += 1;
  }

  // Reactions are a cheap, explicit signal that it landed.
  score += Math.min(2, message.reactions.length);

  return score;
}

export interface SelectionResult {
  selected: SelectedMedia[];
  /** Everything excluded, with the reason, so the UI can be honest about it. */
  skipped: { messageId: string; reason: RejectionReason | "over-budget" | "not-relevant" }[];
  usage: MediaUsage;
}

/**
 * Chooses what to process, most relevant first, inside the limits.
 *
 * Stickers are excluded by default: they are decoration, and processing one
 * costs the same as processing a photograph of something.
 */
export function selectMedia(
  messages: readonly NormalizedMessage[],
  limits: MediaLimits,
  prices: MediaPrices = mediaPrices(),
): SelectionResult {
  const candidates: (SelectedMedia & { score: number })[] = [];
  const skipped: SelectionResult["skipped"] = [];

  messages.forEach((message, index) => {
    for (const attachment of message.media) {
      const validation = validateAttachment(attachment, limits);
      if (!validation.ok || validation.category === null) {
        if (validation.reason) {
          skipped.push({ messageId: message.id, reason: validation.reason });
        }
        continue;
      }
      if (validation.category === "sticker" || validation.category === "document") {
        skipped.push({ messageId: message.id, reason: "not-relevant" });
        continue;
      }
      candidates.push({
        messageId: message.id,
        category: validation.category,
        attachment,
        score: relevanceScore(messages, index),
      });
    }
  });

  candidates.sort((a, b) => b.score - a.score);

  const selected: SelectedMedia[] = [];
  let images = 0;
  let videos = 0;
  let audioSeconds = 0;
  let videoSeconds = 0;

  for (const candidate of candidates) {
    const duration = candidate.attachment.durationSeconds ?? 0;
    let fits = true;

    if (candidate.category === "image") {
      fits = images + 1 <= limits.maxImages;
      if (fits) images += 1;
    } else if (candidate.category === "video") {
      fits =
        videos + 1 <= limits.maxVideos &&
        videoSeconds + duration <= limits.maxVideoSeconds;
      if (fits) {
        videos += 1;
        videoSeconds += duration;
      }
    } else {
      fits = audioSeconds + duration <= limits.maxAudioSeconds;
      if (fits) audioSeconds += duration;
    }

    if (!fits) {
      skipped.push({ messageId: candidate.messageId, reason: "over-budget" });
      continue;
    }
    selected.push({
      messageId: candidate.messageId,
      category: candidate.category,
      attachment: candidate.attachment,
    });
  }

  return { selected, skipped, usage: estimateUsage(selected, prices) };
}
