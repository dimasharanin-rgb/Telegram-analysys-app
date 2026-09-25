/**
 * Voice and audio transcription through AssemblyAI.
 *
 * The only manual setup V3 asks for is `ASSEMBLYAI_API_KEY`. With it unset,
 * transcription is simply not attempted and voice messages appear in the
 * analysis as voice messages of a known length - which is still information.
 *
 * Every failure mode §4 lists is an outcome rather than an exception:
 *
 *   empty or near-silent audio   EMPTY
 *   shorter than a syllable      SKIPPED, before any upload
 *   longer than the ceiling      SKIPPED, before any upload
 *   unsupported container        FAILED, without a request
 *   upload or job error          FAILED after bounded retries
 *   timeout while polling        FAILED, with the job abandoned
 *   rate limited                 retried with backoff, then FAILED
 *
 * `transcribe` never throws. §40 requires one failed transcription to leave the
 * rest of the analysis intact, and the cheapest way to guarantee that is for
 * this method to have no failure path a caller could forget to handle.
 */

import { log } from "@/lib/logger";
import { TranscriptionStatus, type Transcript } from "@/lib/model/event";
import type { MediaPayload, TranscriptionProvider } from "./types";

/**
 * Containers Telegram actually produces for voice notes and shared audio.
 *
 * Telegram voice messages are Opus in an Ogg container; forwarded music is
 * usually mp3 or m4a. Anything else is refused locally rather than uploaded to
 * find out.
 */
const SUPPORTED_MIME: ReadonlySet<string> = new Set([
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
]);

export interface AssemblyAiOptions {
  apiKey: string;
  baseUrl: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  maxAttempts: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  detectLanguage: boolean;
  /** Test seam. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

function notAttempted(detail: string): Transcript {
  return {
    status: TranscriptionStatus.NOT_ATTEMPTED,
    text: "",
    language: null,
    confidence: null,
    detail,
  };
}

function skipped(detail: string): Transcript {
  return {
    status: TranscriptionStatus.SKIPPED,
    text: "",
    language: null,
    confidence: null,
    detail,
  };
}

function failed(detail: string): Transcript {
  return {
    status: TranscriptionStatus.FAILED,
    text: "",
    language: null,
    confidence: null,
    detail,
  };
}

export class AssemblyAiTranscriptionProvider implements TranscriptionProvider {
  readonly name = "assemblyai";

  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: AssemblyAiOptions) {
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  async transcribe(payload: MediaPayload): Promise<Transcript> {
    if (!this.options.apiKey) return notAttempted("no_api_key");

    // --- Cheap local refusals, before spending a request ------------------
    const mime = payload.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
    if (!SUPPORTED_MIME.has(mime)) return failed("unsupported_container");

    if (payload.bytes.byteLength === 0) return skipped("empty_file");

    const duration = payload.durationSeconds ?? null;
    if (duration !== null && duration < this.options.minDurationSeconds) {
      // A 0.3-second voice note is a tap, not an utterance.
      return skipped("too_short");
    }
    if (duration !== null && duration > this.options.maxDurationSeconds) {
      // Refused rather than truncated: half a transcript attributed to a whole
      // recording is worse than an honest absence.
      return skipped("too_long");
    }

    try {
      const uploadUrl = await this.withRetries("upload", () => this.upload(payload));
      if (uploadUrl === null) return failed("upload_failed");

      const jobId = await this.withRetries("submit", () => this.submit(uploadUrl));
      if (jobId === null) return failed("submit_failed");

      return await this.poll(jobId);
    } catch (error) {
      log.warn("transcription.failed", { reason: shortReason(error) });
      return failed(shortReason(error));
    }
  }

  /* --------------------------------------------------------------------- */

  private async upload(payload: MediaPayload): Promise<string> {
    const response = await fetch(`${this.options.baseUrl}/v2/upload`, {
      method: "POST",
      headers: {
        authorization: this.options.apiKey,
        "content-type": "application/octet-stream",
      },
      // A fresh copy: the same Uint8Array may be retried, and some fetch
      // implementations consume the buffer they are handed.
      body: new Uint8Array(payload.bytes),
    });

    if (!response.ok) throw new HttpError(response.status);
    const body = (await response.json()) as { upload_url?: unknown };
    if (typeof body.upload_url !== "string") throw new Error("malformed_upload");
    return body.upload_url;
  }

  private async submit(audioUrl: string): Promise<string> {
    const response = await fetch(`${this.options.baseUrl}/v2/transcript`, {
      method: "POST",
      headers: {
        authorization: this.options.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        // Voice notes in this application are routinely Latvian, Russian and
        // English in the same conversation, so guessing one language for the
        // account would be wrong most of the time.
        ...(this.options.detectLanguage ? { language_detection: true } : {}),
      }),
    });

    if (!response.ok) throw new HttpError(response.status);
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== "string") throw new Error("malformed_submit");
    return body.id;
  }

  private async poll(jobId: string): Promise<Transcript> {
    const deadline = Date.now() + this.options.pollTimeoutMs;

    while (Date.now() < deadline) {
      await this.sleep(this.options.pollIntervalMs);

      let body: TranscriptBody;
      try {
        body = await this.fetchJob(jobId);
      } catch (error) {
        // A blip while polling is not a failed transcription; the job is still
        // running on their side. Keep waiting until the deadline.
        log.debug("transcription.poll_error", { reason: shortReason(error) });
        continue;
      }

      if (body.status === "completed") {
        const text = (body.text ?? "").trim();
        if (text.length === 0) {
          // The provider heard nothing. Silence, or background noise only.
          return {
            status: TranscriptionStatus.EMPTY,
            text: "",
            language: typeof body.language_code === "string" ? body.language_code : null,
            confidence: null,
            detail: "no_speech",
          };
        }
        return {
          status: TranscriptionStatus.COMPLETED,
          text,
          language: typeof body.language_code === "string" ? body.language_code : null,
          confidence:
            typeof body.confidence === "number" && Number.isFinite(body.confidence)
              ? body.confidence
              : null,
          detail: null,
        };
      }

      if (body.status === "error") {
        return failed("provider_error");
      }
    }

    return failed("poll_timeout");
  }

  private async fetchJob(jobId: string): Promise<TranscriptBody> {
    const response = await fetch(`${this.options.baseUrl}/v2/transcript/${jobId}`, {
      headers: { authorization: this.options.apiKey },
    });
    if (!response.ok) throw new HttpError(response.status);
    return (await response.json()) as TranscriptBody;
  }

  /**
   * Retries a step while the failure looks transient.
   *
   * Exponential backoff, because the retryable case that matters most is a 429:
   * a large export can hold hundreds of voice notes, and hammering a rate limit
   * turns a slow analysis into a failed one.
   */
  private async withRetries<T>(
    step: string,
    call: () => Promise<T>,
  ): Promise<T | null> {
    let delay = 1_000;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        return await call();
      } catch (error) {
        const retryable = error instanceof HttpError ? error.retryable : true;
        if (!retryable || attempt === this.options.maxAttempts) {
          log.warn("transcription.step_failed", {
            step,
            attempt,
            reason: shortReason(error),
          });
          return null;
        }
        await this.sleep(delay);
        delay *= 2;
      }
    }
    return null;
  }
}

interface TranscriptBody {
  status?: string;
  text?: string | null;
  language_code?: unknown;
  confidence?: unknown;
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`http_${status}`);
    this.name = "HttpError";
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** An error reduced to a token safe to log. Never a provider message body. */
function shortReason(error: unknown): string {
  if (error instanceof HttpError) return `http_${error.status}`;
  if (error instanceof Error) return error.message.slice(0, 40);
  return "unknown";
}
