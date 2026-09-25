/**
 * Provider contracts for the three things V3 does to media.
 *
 * Deliberately three separate interfaces rather than one "media provider":
 * moderation, visual understanding and transcription are different jobs with
 * different cost profiles, and §6 of the spec is explicit that moderation must
 * stay separate from understanding. Keeping them apart is also what lets the
 * gateway guarantee that an image is cleared before anything describes it -
 * a single combined provider could not be held to that.
 *
 * Every provider takes bytes and returns a verdict. None of them is given the
 * conversation, the participants or the analysis: §34, minimum data necessary.
 */

import type { MediaClassification } from "@/lib/media/classification";
import type { MediaShape, Transcript } from "@/lib/model/event";

/**
 * The bytes, and just enough about them to make a request.
 *
 * No message id, no sender, no surrounding text. A classifier does not need
 * the conversation to decide whether a photograph is explicit, and giving it
 * one would be sending private text to a provider for no reason.
 */
export interface MediaPayload {
  bytes: Uint8Array;
  mimeType: string;
  /** Seconds, for audio. Used to reject before spending, not sent onward. */
  durationSeconds?: number;
}

export interface ProviderFailure {
  ok: false;
  /** Short internal reason. Never shown to a user, never put in a prompt. */
  detail: string;
  /** True when retrying could plausibly work: timeout, 429, 5xx. */
  retryable: boolean;
}

export type ProviderResult<T> = ({ ok: true } & T) | ProviderFailure;

/* -------------------------------------------------------------------------
 * Moderation
 * ---------------------------------------------------------------------- */

/**
 * What moderation reports.
 *
 * `classification` is the decision the gateway acts on. `suspectedIllegal` is
 * separate and stronger: it is not one classification among others, it is a
 * stop signal, and it exists as its own field so that no future edit to the
 * classification enum can accidentally make it routable.
 */
export interface ModerationVerdict {
  classification: MediaClassification;
  suspectedIllegal: boolean;
  /** 0-1 where the provider reports one. Low confidence fails closed. */
  confidence: number | null;
}

export interface ModerationProvider {
  readonly name: string;
  classify(payload: MediaPayload): Promise<ProviderResult<ModerationVerdict>>;
}

/* -------------------------------------------------------------------------
 * Vision
 * ---------------------------------------------------------------------- */

export interface VisionFinding {
  /** One or two sentences. What is in the image, not what it means. */
  description: string;
  /** Verbatim text in the image, when there is any worth quoting. */
  extractedText: string | null;
  shape: MediaShape;
  /** The model's own confidence in the reading. */
  confidence: "high" | "medium" | "low";
}

export interface VisionProvider {
  readonly name: string;
  /**
   * Describes an image the gateway has already cleared.
   *
   * Implementations must not be reachable for uncleared content: the gateway
   * is the only caller, and it checks `mayDescribe` first.
   */
  describe(payload: MediaPayload): Promise<ProviderResult<VisionFinding>>;
}

/* -------------------------------------------------------------------------
 * Transcription
 * ---------------------------------------------------------------------- */

export interface TranscriptionProvider {
  readonly name: string;
  /**
   * Returns a `Transcript` in every case, including failure.
   *
   * Failure is an outcome rather than an exception because §40 requires that a
   * failed transcription leave the rest of the analysis running. A provider
   * that threw would make every caller responsible for remembering that.
   */
  transcribe(payload: MediaPayload): Promise<Transcript>;
}
