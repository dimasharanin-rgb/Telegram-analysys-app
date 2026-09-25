/**
 * Central configuration.
 *
 * Every tunable that affects cost, size limits or pipeline behaviour lives
 * here so that nothing expensive is hard-coded across the codebase. Values are
 * read from the environment once, with documented defaults.
 *
 * Server-only values (API keys, model settings) are read lazily inside
 * `serverConfig()` so that importing this module from a client bundle never
 * touches them.
 */

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Parses `TASK=model,TASK=model` into a lookup.
 *
 * Deliberately forgiving: a malformed entry is dropped rather than throwing,
 * because a typo in one override should not stop the application starting.
 */
function parseTaskModels(raw: string | undefined): Readonly<Record<string, string>> {
  if (!raw?.trim()) return Object.freeze({});
  const out: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const task = entry.slice(0, separator).trim().toUpperCase();
    const model = entry.slice(separator + 1).trim();
    if (task && model) out[task] = model;
  }
  return Object.freeze(out);
}

function effort(raw: string | undefined, fallback: EffortLevel): EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(raw ?? "")
    ? (raw as EffortLevel)
    : fallback;
}

/**
 * Limits that the browser also needs to know about (to validate before
 * uploading). Safe to import from client components.
 */
export const publicLimits = {
  /** Largest Telegram export we will even attempt to read, in bytes. */
  maxUploadBytes: num(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB, 100, 1, 1024) * 1024 * 1024,
  /** Below this, an export is treated as too small to say anything about. */
  minMessagesForAnalysis: 20,
} as const;

/**
 * The three model tiers V3 routes between.
 *
 * Named by what they are for rather than by vendor tier, so the mapping from
 * a tier to an actual model id is configuration and nothing in the analysis
 * logic has to change when a model is swapped.
 */
export interface ModelTierConfig {
  /** High-volume, low-judgement work: classification, detection, filtering. */
  cheap: string;
  /** The default for serious contextual analysis. */
  standard: string;
  /** Reserved for reasoning where the extra capability is worth the price. */
  deep: string;
}

export interface ServerConfig {
  anthropic: {
    apiKey: string;
    /** Override the API endpoint — a gateway or egress proxy. Empty means the public one. */
    baseUrl: string;
    models: ModelTierConfig;
    /**
     * Per-task model overrides, parsed from `ANTHROPIC_TASK_MODELS`. Lets one
     * task be moved off its tier's model without touching any routing code.
     */
    taskModels: Readonly<Record<string, string>>;
    /** Effort per tier, so a cheap call does not silently think expensively. */
    tierEffort: Readonly<Record<keyof ModelTierConfig, EffortLevel>>;
    maxOutputTokens: number;
    effort: EffortLevel;
    synthesisEffort: EffortLevel;
    timeoutMs: number;
    maxRetries: number;
    /**
     * USD per million tokens, used only for internal cost accounting. A token
     * costs exactly this many micro-dollars, which is why usage is recorded in
     * micros - no floating point touches a stored figure.
     */
    pricing: {
      inputPerMTok: number;
      outputPerMTok: number;
      cacheReadPerMTok: number;
    };
    /**
     * Per-tier prices in USD per million tokens. Routing only pays for itself
     * if the accounting knows a cheap call cost less, so each tier carries its
     * own figures and the flat `pricing` block above stays as the fallback for
     * a model that matches no tier.
     */
    tierPricing: Readonly<
      Record<keyof ModelTierConfig, { inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok: number }>
    >;
  };
  pipeline: {
    /** At or below this message count we use the cheaper single-pass strategy. */
    singlePassMaxMessages: number;
    /** Character budget for excerpts handed to Claude in a single call. */
    excerptCharBudget: number;
    /** Hard ceiling on map-phase chunk calls. */
    maxChunks: number;
    /** Inactivity gap (minutes) that separates two conversations. */
    conversationGapMinutes: number;
  };
  limits: {
    maxAnalyzeRequestBytes: number;
    rateLimitMaxRequests: number;
    rateLimitWindowMs: number;
  };
  consent: {
    /** How long a consent link stays usable. */
    validForDays: number;
    /** Shown on the consent page and in the document. */
    aiProviderName: string;
    /** Absolute base used to build consent links. */
    appUrl: string;
  };
  /**
   * External media providers. Each is independently configurable and each is
   * off unless its key is present, because the safe default for private
   * photographs and voice notes is that nothing leaves the machine.
   */
  media: {
    /** Voice/audio transcription. AssemblyAI is the shipped implementation. */
    transcription: {
      provider: string;
      apiKey: string;
      baseUrl: string;
      /** Poll interval and ceiling for the provider's async job. */
      pollIntervalMs: number;
      pollTimeoutMs: number;
      maxAttempts: number;
      /** Below this, a recording is treated as too short to be worth sending. */
      minDurationSeconds: number;
      /** Above this, a recording is skipped rather than silently truncated. */
      maxDurationSeconds: number;
      /** Ask the provider to detect the spoken language rather than assuming. */
      detectLanguage: boolean;
    };
    /**
     * Image safety classification. Runs before any image is described, and
     * when it is not configured no image is described at all - the gateway
     * fails closed rather than guessing that a photograph is innocuous.
     */
    moderation: {
      provider: string;
      model: string;
      apiKey: string;
      baseUrl: string;
    };
    /** Visual understanding, for images the moderation step cleared. */
    vision: {
      provider: string;
      model: string;
      apiKey: string;
      baseUrl: string;
    };
    /** Where uploaded media is kept. Never inside a publicly served directory. */
    storageDir: string;
  };
  debug: boolean;
}

let cached: ServerConfig | null = null;

/**
 * Reads and validates server-side configuration.
 *
 * Throws only when the Anthropic key is missing, which is a deployment error
 * rather than a user error; callers translate it into a friendly message.
 */
export function serverConfig(): ServerConfig {
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";

  cached = {
    anthropic: {
      apiKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL?.trim() ?? "",
      models: {
        cheap: process.env.ANTHROPIC_MODEL_CHEAP?.trim() || "claude-haiku-4-5",
        // `ANTHROPIC_MODEL` was the single model in V2. Honoured here as the
        // standard tier so an existing deployment keeps working, but it no
        // longer decides what every call uses.
        standard:
          process.env.ANTHROPIC_MODEL_STANDARD?.trim() ||
          process.env.ANTHROPIC_MODEL?.trim() ||
          "claude-sonnet-5",
        deep: process.env.ANTHROPIC_MODEL_DEEP?.trim() || "claude-opus-5",
      },
      taskModels: parseTaskModels(process.env.ANTHROPIC_TASK_MODELS),
      tierEffort: {
        cheap: effort(process.env.ANTHROPIC_EFFORT_CHEAP, "low"),
        standard: effort(process.env.ANTHROPIC_EFFORT, "medium"),
        deep: effort(process.env.ANTHROPIC_EFFORT_SYNTHESIS, "high"),
      },
      maxOutputTokens: num(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS, 8000, 1024, 64000),
      effort: effort(process.env.ANTHROPIC_EFFORT, "medium"),
      synthesisEffort: effort(process.env.ANTHROPIC_EFFORT_SYNTHESIS, "high"),
      timeoutMs: num(process.env.ANTHROPIC_TIMEOUT_MS, 120_000, 10_000, 600_000),
      maxRetries: num(process.env.ANTHROPIC_MAX_RETRIES, 2, 0, 5),
      pricing: {
        inputPerMTok: num(process.env.ANTHROPIC_PRICE_INPUT_PER_MTOK, 5, 0, 1_000),
        outputPerMTok: num(process.env.ANTHROPIC_PRICE_OUTPUT_PER_MTOK, 25, 0, 1_000),
        cacheReadPerMTok: num(process.env.ANTHROPIC_PRICE_CACHE_READ_PER_MTOK, 0.5, 0, 1_000),
      },
      tierPricing: {
        cheap: {
          inputPerMTok: num(process.env.ANTHROPIC_PRICE_CHEAP_INPUT_PER_MTOK, 1, 0, 1_000),
          outputPerMTok: num(process.env.ANTHROPIC_PRICE_CHEAP_OUTPUT_PER_MTOK, 5, 0, 1_000),
          cacheReadPerMTok: num(process.env.ANTHROPIC_PRICE_CHEAP_CACHE_READ_PER_MTOK, 0.1, 0, 1_000),
        },
        standard: {
          inputPerMTok: num(process.env.ANTHROPIC_PRICE_STANDARD_INPUT_PER_MTOK, 2, 0, 1_000),
          outputPerMTok: num(process.env.ANTHROPIC_PRICE_STANDARD_OUTPUT_PER_MTOK, 10, 0, 1_000),
          cacheReadPerMTok: num(process.env.ANTHROPIC_PRICE_STANDARD_CACHE_READ_PER_MTOK, 0.2, 0, 1_000),
        },
        deep: {
          inputPerMTok: num(process.env.ANTHROPIC_PRICE_INPUT_PER_MTOK, 5, 0, 1_000),
          outputPerMTok: num(process.env.ANTHROPIC_PRICE_OUTPUT_PER_MTOK, 25, 0, 1_000),
          cacheReadPerMTok: num(process.env.ANTHROPIC_PRICE_CACHE_READ_PER_MTOK, 0.5, 0, 1_000),
        },
      },
    },
    pipeline: {
      singlePassMaxMessages: num(
        process.env.ANALYSIS_SINGLE_PASS_MAX_MESSAGES,
        800,
        50,
        20_000,
      ),
      excerptCharBudget: num(process.env.ANALYSIS_EXCERPT_CHAR_BUDGET, 45_000, 2_000, 400_000),
      maxChunks: num(process.env.ANALYSIS_MAX_CHUNKS, 8, 1, 40),
      conversationGapMinutes: num(process.env.ANALYSIS_CONVERSATION_GAP_MINUTES, 360, 5, 10_080),
    },
    limits: {
      maxAnalyzeRequestBytes: num(process.env.MAX_ANALYZE_REQUEST_MB, 8, 1, 64) * 1024 * 1024,
      rateLimitMaxRequests: num(process.env.RATE_LIMIT_MAX_REQUESTS, 10, 1, 1000),
      rateLimitWindowMs: num(process.env.RATE_LIMIT_WINDOW_MINUTES, 10, 1, 1440) * 60_000,
    },
    consent: {
      validForDays: num(process.env.CONSENT_VALID_DAYS, 14, 1, 365),
      aiProviderName: process.env.AI_PROVIDER_NAME?.trim() || "Anthropic (Claude)",
      appUrl: (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, ""),
    },
    media: {
      transcription: {
        provider: process.env.TRANSCRIPTION_PROVIDER?.trim() || "assemblyai",
        apiKey: process.env.ASSEMBLYAI_API_KEY?.trim() ?? "",
        baseUrl:
          process.env.ASSEMBLYAI_BASE_URL?.trim() || "https://api.assemblyai.com",
        pollIntervalMs: num(process.env.TRANSCRIPTION_POLL_INTERVAL_MS, 3_000, 500, 60_000),
        pollTimeoutMs: num(process.env.TRANSCRIPTION_POLL_TIMEOUT_MS, 300_000, 10_000, 1_800_000),
        maxAttempts: num(process.env.TRANSCRIPTION_MAX_ATTEMPTS, 3, 1, 6),
        minDurationSeconds: num(process.env.TRANSCRIPTION_MIN_SECONDS, 1, 0, 60),
        maxDurationSeconds: num(process.env.TRANSCRIPTION_MAX_SECONDS, 1_800, 10, 14_400),
        detectLanguage: process.env.TRANSCRIPTION_DETECT_LANGUAGE !== "0",
      },
      moderation: {
        provider: process.env.MODERATION_PROVIDER?.trim() || "",
        model: process.env.MODERATION_MODEL?.trim() || "",
        apiKey: process.env.MODERATION_API_KEY?.trim() ?? "",
        baseUrl: process.env.MODERATION_BASE_URL?.trim() ?? "",
      },
      vision: {
        provider: process.env.IMAGE_ANALYSIS_PROVIDER?.trim() || "",
        model: process.env.IMAGE_ANALYSIS_MODEL?.trim() || "",
        apiKey: process.env.IMAGE_ANALYSIS_API_KEY?.trim() ?? "",
        baseUrl: process.env.IMAGE_ANALYSIS_BASE_URL?.trim() ?? "",
      },
      storageDir: process.env.MEDIA_STORAGE_DIR?.trim() || "./data/media",
    },
    debug: process.env.ANALYZER_DEBUG === "1",
  };

  return cached;
}

/** Test seam: forget memoised config so env changes take effect. */
export function resetServerConfigCache(): void {
  cached = null;
}
