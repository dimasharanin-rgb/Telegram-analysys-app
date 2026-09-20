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

export interface ServerConfig {
  anthropic: {
    apiKey: string;
    /** Override the API endpoint — a gateway or egress proxy. Empty means the public one. */
    baseUrl: string;
    model: string;
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
      model: process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5",
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
    debug: process.env.ANALYZER_DEBUG === "1",
  };

  return cached;
}

/** Test seam: forget memoised config so env changes take effect. */
export function resetServerConfigCache(): void {
  cached = null;
}
