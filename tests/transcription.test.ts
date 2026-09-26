import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AssemblyAiTranscriptionProvider,
  type AssemblyAiOptions,
} from "@/lib/media/providers/assemblyai";
import { TranscriptionStatus } from "@/lib/model/event";
import type { MediaPayload } from "@/lib/media/providers/types";
import {
  CATEGORY_THRESHOLD,
  ILLEGAL_THRESHOLD,
  interpretModerationBody,
} from "@/lib/media/providers/http-moderation";
import { MediaClassification } from "@/lib/media/classification";
import { resetServerConfigCache, serverConfig } from "@/lib/config";

/* -------------------------------------------------------------------------
 * AssemblyAI
 * ---------------------------------------------------------------------- */

const VOICE: MediaPayload = {
  bytes: new Uint8Array([1, 2, 3, 4]),
  mimeType: "audio/ogg",
  durationSeconds: 18.4,
};

function provider(over: Partial<AssemblyAiOptions> = {}): AssemblyAiTranscriptionProvider {
  return new AssemblyAiTranscriptionProvider({
    apiKey: "test-key",
    baseUrl: "https://api.example.test",
    speechModels: ["universal-3-5-pro", "universal-2"],
    pollIntervalMs: 1,
    pollTimeoutMs: 100,
    maxAttempts: 3,
    minDurationSeconds: 1,
    maxDurationSeconds: 1_800,
    detectLanguage: true,
    // No real waiting: the retry and poll logic is what is under test, not the
    // clock.
    sleep: async () => {},
    ...over,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transcription is not attempted without a key", () => {
  it("reports NOT_ATTEMPTED and makes no request", async () => {
    const transcript = await provider({ apiKey: "" }).transcribe(VOICE);

    expect(transcript.status).toBe(TranscriptionStatus.NOT_ATTEMPTED);
    expect(transcript.detail).toBe("no_api_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("audio is refused locally before anything is uploaded", () => {
  it("refuses a container no provider reads", async () => {
    const transcript = await provider().transcribe({ ...VOICE, mimeType: "audio/amr" });

    expect(transcript.status).toBe(TranscriptionStatus.FAILED);
    expect(transcript.detail).toBe("unsupported_container");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips a recording too short to be an utterance", async () => {
    const transcript = await provider().transcribe({ ...VOICE, durationSeconds: 0.3 });

    expect(transcript.status).toBe(TranscriptionStatus.SKIPPED);
    expect(transcript.detail).toBe("too_short");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips a recording past the ceiling rather than truncating it", async () => {
    const transcript = await provider().transcribe({ ...VOICE, durationSeconds: 9_000 });

    expect(transcript.status).toBe(TranscriptionStatus.SKIPPED);
    expect(transcript.detail).toBe("too_long");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips an empty file", async () => {
    const transcript = await provider().transcribe({ ...VOICE, bytes: new Uint8Array() });

    expect(transcript.status).toBe(TranscriptionStatus.SKIPPED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a voice note whose mime type carries parameters", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ upload_url: "https://cdn.example.test/a" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValueOnce(
        jsonResponse({ status: "completed", text: "hello", language_code: "en", confidence: 0.9 }),
      );

    const transcript = await provider().transcribe({
      ...VOICE,
      mimeType: "audio/ogg; codecs=opus",
    });
    expect(transcript.status).toBe(TranscriptionStatus.COMPLETED);
  });
});

describe("a successful transcription", () => {
  it("returns the words, the detected language and the confidence", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ upload_url: "https://cdn.example.test/a" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValueOnce(jsonResponse({ status: "processing" }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "completed",
          text: "  sorry, I got held up at work  ",
          language_code: "en",
          confidence: 0.94,
        }),
      );

    const transcript = await provider().transcribe(VOICE);

    expect(transcript.status).toBe(TranscriptionStatus.COMPLETED);
    expect(transcript.text).toBe("sorry, I got held up at work");
    expect(transcript.language).toBe("en");
    expect(transcript.confidence).toBe(0.94);
    expect(transcript.detail).toBeNull();
  });

  it("sends the model fallback list rather than letting the API choose", async () => {
    // Omitting speech_models does not mean "the newest model" - it means the
    // API applies its own older default, so the flagship never runs. This was
    // a live defect.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ upload_url: "https://cdn.example.test/a" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", text: "hello" }));

    await provider().transcribe(VOICE);

    const submitBody = JSON.parse(String(fetchMock.mock.calls[1]![1].body));
    expect(submitBody.speech_models).toEqual(["universal-3-5-pro", "universal-2"]);
  });

  it("lets the model list be reconfigured without touching the provider", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ upload_url: "https://cdn.example.test/a" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", text: "hello" }));

    await provider({ speechModels: ["some-newer-model"] }).transcribe(VOICE);

    const submitBody = JSON.parse(String(fetchMock.mock.calls[1]![1].body));
    expect(submitBody.speech_models).toEqual(["some-newer-model"]);
  });

  it("asks the provider to detect the language rather than assuming one", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ upload_url: "https://cdn.example.test/a" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", text: "labdien" }));

    await provider().transcribe(VOICE);

    const submitBody = JSON.parse(String(fetchMock.mock.calls[1]![1].body));
    // These conversations routinely switch between Latvian, Russian and
    // English, so a fixed account language would be wrong most of the time.
    expect(submitBody.language_detection).toBe(true);
  });

  it("reports silence as EMPTY rather than as a successful blank", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ upload_url: "https://cdn.example.test/a" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", text: "   " }));

    const transcript = await provider().transcribe(VOICE);

    expect(transcript.status).toBe(TranscriptionStatus.EMPTY);
    expect(transcript.text).toBe("");
    expect(transcript.detail).toBe("no_speech");
  });
});

describe("failures are outcomes, never exceptions", () => {
  it("survives an upload that keeps failing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));

    const transcript = await provider().transcribe(VOICE);
    expect(transcript.status).toBe(TranscriptionStatus.FAILED);
    expect(transcript.detail).toBe("upload_failed");
  });

  it("retries a rate limit and succeeds on the next attempt", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "slow down" }, 429))
      .mockResolvedValueOnce(jsonResponse({ upload_url: "https://cdn.example.test/a" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", text: "ok then" }));

    const transcript = await provider().transcribe(VOICE);
    expect(transcript.status).toBe(TranscriptionStatus.COMPLETED);
    expect(transcript.text).toBe("ok then");
  });

  it("does not retry a request that was simply wrong", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad audio" }, 400));

    await provider().transcribe(VOICE);
    // One upload attempt, not three: a 400 will be a 400 again.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a provider-side job error", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ upload_url: "https://cdn.example.test/a" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValueOnce(jsonResponse({ status: "error", error: "decode failed" }));

    const transcript = await provider().transcribe(VOICE);
    expect(transcript.status).toBe(TranscriptionStatus.FAILED);
    expect(transcript.detail).toBe("provider_error");
  });

  it("gives up on a job that never finishes", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ upload_url: "https://cdn.example.test/a" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValue(jsonResponse({ status: "processing" }));

    const transcript = await provider({ pollTimeoutMs: 5 }).transcribe(VOICE);
    expect(transcript.status).toBe(TranscriptionStatus.FAILED);
    expect(transcript.detail).toBe("poll_timeout");
  });

  it("keeps polling through a transient error mid-job", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ upload_url: "https://cdn.example.test/a" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1" }))
      .mockResolvedValueOnce(jsonResponse({}, 502))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", text: "got there" }));

    const transcript = await provider().transcribe(VOICE);
    expect(transcript.status).toBe(TranscriptionStatus.COMPLETED);
  });

  it("survives a network layer that throws", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    const transcript = await provider().transcribe(VOICE);
    expect(transcript.status).toBe(TranscriptionStatus.FAILED);
  });

  it("never puts a provider message into the transcript", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "key sk-live-abc123 is invalid" }, 401),
    );

    const transcript = await provider().transcribe(VOICE);
    expect(transcript.text).toBe("");
    expect(JSON.stringify(transcript)).not.toContain("sk-live");
  });
});

/* -------------------------------------------------------------------------
 * HTTP moderation mapping
 * ---------------------------------------------------------------------- */

describe("moderation scores map to classifications", () => {
  const body = (categories: Record<string, number>, confidence = 0.9) => ({
    categories,
    confidence,
  });

  it("treats any hint of minors as a hard stop, at a far lower threshold", () => {
    const result = interpretModerationBody(
      body({ "sexual/minors": ILLEGAL_THRESHOLD, sexual: 0 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suspectedIllegal).toBe(true);
      expect(result.classification).toBe(MediaClassification.RESTRICTED);
    }
    // The threshold for this is deliberately far below the ordinary one.
    expect(ILLEGAL_THRESHOLD).toBeLessThan(CATEGORY_THRESHOLD);
  });

  it("matches vendor spellings regardless of separators and case", () => {
    for (const key of ["sexual_minors", "Sexual/Minors", "CSAM", "childSexual"]) {
      const result = interpretModerationBody(body({ [key]: 0.9 }));
      expect(result.ok && result.suspectedIllegal).toBe(true);
    }
  });

  it("maps explicit, violent and document categories", () => {
    const cases: [string, MediaClassification][] = [
      ["sexual", MediaClassification.SEXUAL_EXPLICIT],
      ["suggestive", MediaClassification.SEXUAL_SUGGESTIVE],
      ["violence", MediaClassification.VIOLENT],
      ["gore", MediaClassification.GRAPHIC],
      ["self-harm", MediaClassification.GRAPHIC],
      ["identity_document", MediaClassification.PERSONAL_DOCUMENT],
      ["nudity", MediaClassification.SENSITIVE],
    ];
    for (const [key, expected] of cases) {
      const result = interpretModerationBody(body({ [key]: 0.8 }));
      expect(result.ok && result.classification).toBe(expected);
    }
  });

  it("picks the more restrictive label when two categories score", () => {
    const result = interpretModerationBody(body({ violence: 0.9, sexual: 0.9 }));
    expect(result.ok && result.classification).toBe(MediaClassification.SEXUAL_EXPLICIT);
  });

  it("ignores a category below the threshold", () => {
    const result = interpretModerationBody(body({ sexual: CATEGORY_THRESHOLD - 0.01 }));
    expect(result.ok && result.classification).toBe(MediaClassification.ORDINARY);
  });

  it("treats a clean response as ordinary", () => {
    const result = interpretModerationBody(body({ sexual: 0.01, violence: 0.02 }));
    expect(result.ok && result.classification).toBe(MediaClassification.ORDINARY);
    expect(result.ok && result.confidence).toBe(0.9);
  });

  it("refuses a malformed body rather than assuming it was clean", () => {
    for (const malformed of [null, "nope", 42, {}, { categories: "no" }]) {
      const result = interpretModerationBody(malformed);
      expect(result.ok).toBe(false);
    }
  });

  it("passes through a missing confidence as unknown rather than certain", () => {
    const result = interpretModerationBody({ categories: {} });
    expect(result.ok && result.confidence).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * Configuration defaults
 * ---------------------------------------------------------------------- */

describe("the shipped configuration", () => {
  afterEach(() => {
    delete process.env.ASSEMBLYAI_BASE_URL;
    delete process.env.ASSEMBLYAI_SPEECH_MODELS;
    resetServerConfigCache();
  });

  it("sends audio to the EU region by default", () => {
    resetServerConfigCache();
    // The audio is private conversation, and the consent document names where
    // it goes - so the region is part of what was disclosed, not a deployment
    // detail to be discovered later.
    expect(serverConfig().media.transcription.baseUrl).toBe(
      "https://api.eu.assemblyai.com",
    );
  });

  it("can be pointed at another region", () => {
    process.env.ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com";
    resetServerConfigCache();
    expect(serverConfig().media.transcription.baseUrl).toBe(
      "https://api.assemblyai.com",
    );
  });

  it("defaults to the flagship model with a broad-coverage fallback", () => {
    resetServerConfigCache();
    expect(serverConfig().media.transcription.speechModels).toEqual([
      "universal-3-5-pro",
      "universal-2",
    ]);
  });

  it("takes a reconfigured model list, ignoring blanks", () => {
    process.env.ASSEMBLYAI_SPEECH_MODELS = " model-a , , model-b ";
    resetServerConfigCache();
    expect(serverConfig().media.transcription.speechModels).toEqual([
      "model-a",
      "model-b",
    ]);
  });

  it("falls back to the defaults when the list is empty", () => {
    process.env.ASSEMBLYAI_SPEECH_MODELS = "  , ,  ";
    resetServerConfigCache();
    expect(serverConfig().media.transcription.speechModels).toEqual([
      "universal-3-5-pro",
      "universal-2",
    ]);
  });
});
