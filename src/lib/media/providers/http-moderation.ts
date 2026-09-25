/**
 * Moderation through a dedicated HTTP service.
 *
 * This is the option that keeps the safety decision away from Claude entirely,
 * which is what §6 asks for. Rather than pretending to speak every vendor's
 * dialect, it defines one small contract and leaves the vendor-specific part to
 * whatever sits behind the URL - typically a few lines in front of a hosted
 * moderation API.
 *
 * Request  POST {MODERATION_BASE_URL}
 *          Authorization: Bearer {MODERATION_API_KEY}
 *          { "mimeType": "image/jpeg", "dataBase64": "..." }
 *
 * Response { "categories": { "sexual": 0.01, "sexual_minors": 0.0, ... },
 *            "confidence": 0.93 }
 *
 * Category names are matched case-insensitively and with `/`, `-` and `_`
 * treated alike, so the common vendor spellings all land in the right place
 * without configuration.
 *
 * Anything unexpected - a non-200, a body that does not parse, a missing
 * categories object - is a failure, and a failure means the image is not
 * described. There is no lenient path.
 */

import { MediaClassification } from "@/lib/media/classification";
import type {
  MediaPayload,
  ModerationProvider,
  ModerationVerdict,
  ProviderResult,
} from "./types";

/**
 * Score above which a category is considered present.
 *
 * One threshold for everything except the illegal check, which is deliberately
 * far lower: the cost of a false positive there is an image going unanalysed,
 * and the cost of a false negative is unacceptable.
 */
export const CATEGORY_THRESHOLD = 0.5;
export const ILLEGAL_THRESHOLD = 0.1;

/**
 * Category name to classification, most serious first.
 *
 * Order matters: an image scoring on both `sexual` and `violence` is handled by
 * whichever rule appears earlier, so the more restrictive label wins.
 */
const CATEGORY_RULES: readonly {
  keys: readonly string[];
  classification: MediaClassification;
}[] = [
  { keys: ["sexualexplicit", "sexual"], classification: MediaClassification.SEXUAL_EXPLICIT },
  { keys: ["sexualsuggestive", "suggestive"], classification: MediaClassification.SEXUAL_SUGGESTIVE },
  { keys: ["selfharm"], classification: MediaClassification.GRAPHIC },
  { keys: ["violencegraphic", "graphic", "gore"], classification: MediaClassification.GRAPHIC },
  { keys: ["violence"], classification: MediaClassification.VIOLENT },
  { keys: ["personaldocument", "document", "identitydocument"], classification: MediaClassification.PERSONAL_DOCUMENT },
  { keys: ["nudity", "intimate", "sensitive"], classification: MediaClassification.SENSITIVE },
];

/** Categories that mean stop, whatever else the response says. */
const ILLEGAL_KEYS = ["sexualminors", "csam", "childsexual", "minors"];

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

export interface HttpModerationOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class HttpModerationProvider implements ModerationProvider {
  readonly name = "http";

  constructor(private readonly options: HttpModerationOptions) {}

  async classify(payload: MediaPayload): Promise<ProviderResult<ModerationVerdict>> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 30_000,
    );

    try {
      const response = await fetch(this.options.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.apiKey
            ? { authorization: `Bearer ${this.options.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          mimeType: payload.mimeType,
          dataBase64: Buffer.from(payload.bytes).toString("base64"),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          detail: `status_${response.status}`,
          retryable: response.status === 429 || response.status >= 500,
        };
      }

      const body: unknown = await response.json();
      return interpretModerationBody(body);
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        ok: false,
        detail: aborted ? "timeout" : "request_failed",
        retryable: true,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Turns a response body into a verdict.
 *
 * Exported for tests: the mapping from vendor category names to our
 * classifications is the part most likely to be wrong, and it is worth being
 * able to check it without a network.
 */
export function interpretModerationBody(
  body: unknown,
): ProviderResult<ModerationVerdict> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, detail: "malformed_body", retryable: false };
  }

  const raw = (body as { categories?: unknown }).categories;
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, detail: "missing_categories", retryable: false };
  }

  const scores = new Map<string, number>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      scores.set(normaliseKey(key), value);
    }
  }

  const suspectedIllegal = ILLEGAL_KEYS.some(
    (key) => (scores.get(key) ?? 0) >= ILLEGAL_THRESHOLD,
  );
  if (suspectedIllegal) {
    return {
      ok: true,
      classification: MediaClassification.RESTRICTED,
      suspectedIllegal: true,
      confidence: 1,
    };
  }

  const reportedConfidence = (body as { confidence?: unknown }).confidence;
  const confidence =
    typeof reportedConfidence === "number" && Number.isFinite(reportedConfidence)
      ? Math.min(1, Math.max(0, reportedConfidence))
      : null;

  for (const rule of CATEGORY_RULES) {
    const hit = rule.keys.some((key) => (scores.get(key) ?? 0) >= CATEGORY_THRESHOLD);
    if (hit) {
      return {
        ok: true,
        classification: rule.classification,
        suspectedIllegal: false,
        confidence,
      };
    }
  }

  // Nothing scored. An empty categories object means the service looked and
  // found nothing, which is a real ORDINARY - unlike a missing object, which
  // is handled above as malformed.
  return {
    ok: true,
    classification: MediaClassification.ORDINARY,
    suspectedIllegal: false,
    confidence,
  };
}
