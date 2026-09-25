/**
 * Configuration to providers.
 *
 * Every "is this feature on?" question in the media pipeline is answered here,
 * and the answer is always derived from whether the thing it needs is
 * configured - never from a separate feature flag that could disagree with
 * reality.
 *
 * The defaults are the conservative ones. With an empty environment: no
 * moderation, therefore no image description, therefore no image bytes leaving
 * the machine; no transcription key, therefore no audio leaving it either. The
 * application still analyses the conversation's text, and says what it did not
 * read.
 */

import { serverConfig } from "@/lib/config";
import { log } from "@/lib/logger";
import type { AttachmentAnalyser } from "@/lib/ai/claude";
import { AssemblyAiTranscriptionProvider } from "./assemblyai";
import { ClaudeModerationProvider, ClaudeVisionProvider } from "./claude";
import { HttpModerationProvider } from "./http-moderation";
import type {
  ModerationProvider,
  TranscriptionProvider,
  VisionProvider,
} from "./types";

export interface MediaProviders {
  moderation: ModerationProvider | null;
  vision: VisionProvider | null;
  transcription: TranscriptionProvider | null;
}

/**
 * Why a provider is off, in words an operator can act on.
 *
 * Surfaced in logs at startup and on the analysis's own media summary, so "my
 * voice messages were not transcribed" has a findable answer that is not
 * "read the source".
 */
export interface ProviderStatus {
  moderation: string | null;
  vision: string | null;
  transcription: string | null;
}

/**
 * Builds the providers for one analysis.
 *
 * `analyser` is the Claude service. It is passed in rather than constructed
 * here so that a caller running without an Anthropic key - or a test - can get
 * the media providers without one.
 */
export function mediaProviders(analyser: AttachmentAnalyser | null): MediaProviders {
  const config = serverConfig().media;

  return {
    moderation: buildModeration(config.moderation, analyser),
    vision: buildVision(config.vision, analyser),
    transcription: buildTranscription(config.transcription),
  };
}

export function providerStatus(): ProviderStatus {
  const config = serverConfig().media;

  return {
    moderation:
      config.moderation.provider === ""
        ? "MODERATION_PROVIDER is not set, so no image is examined or described"
        : config.moderation.provider === "http" && !config.moderation.baseUrl
          ? "MODERATION_BASE_URL is not set"
          : null,
    vision:
      config.vision.provider === ""
        ? "IMAGE_ANALYSIS_PROVIDER is not set, so cleared images are not described"
        : null,
    transcription: !config.transcription.apiKey
      ? "ASSEMBLYAI_API_KEY is not set, so voice messages are not transcribed"
      : null,
  };
}

function buildModeration(
  config: ReturnType<typeof serverConfig>["media"]["moderation"],
  analyser: AttachmentAnalyser | null,
): ModerationProvider | null {
  switch (config.provider) {
    case "":
      return null;

    case "claude":
      if (analyser === null) return null;
      // An explicit operator choice: images are classified by Anthropic before
      // anything else happens to them. Logged once per process so it is visible
      // in a deployment rather than only in the environment file.
      log.info("media.moderation_provider", { provider: "claude" });
      return new ClaudeModerationProvider(analyser);

    case "http":
      if (!config.baseUrl) {
        log.warn("media.moderation_misconfigured", { reason: "no_base_url" });
        return null;
      }
      return new HttpModerationProvider({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
      });

    default:
      log.warn("media.moderation_unknown_provider", { provider: config.provider });
      return null;
  }
}

function buildVision(
  config: ReturnType<typeof serverConfig>["media"]["vision"],
  analyser: AttachmentAnalyser | null,
): VisionProvider | null {
  switch (config.provider) {
    case "":
      return null;
    case "claude":
      return analyser === null ? null : new ClaudeVisionProvider(analyser);
    default:
      log.warn("media.vision_unknown_provider", { provider: config.provider });
      return null;
  }
}

function buildTranscription(
  config: ReturnType<typeof serverConfig>["media"]["transcription"],
): TranscriptionProvider | null {
  if (!config.apiKey) return null;

  switch (config.provider) {
    case "assemblyai":
      return new AssemblyAiTranscriptionProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        pollIntervalMs: config.pollIntervalMs,
        pollTimeoutMs: config.pollTimeoutMs,
        maxAttempts: config.maxAttempts,
        minDurationSeconds: config.minDurationSeconds,
        maxDurationSeconds: config.maxDurationSeconds,
        detectLanguage: config.detectLanguage,
      });
    default:
      log.warn("media.transcription_unknown_provider", { provider: config.provider });
      return null;
  }
}
