/**
 * A small error taxonomy shared by the parser, the pipeline and the API routes.
 *
 * Every error that can reach a user carries a stable `code` and a
 * human-readable `userMessage`. Stack traces, provider payloads and API keys
 * never cross that boundary - `toUserFacing()` is the only thing serialised to
 * the client.
 */

export type AppErrorCode =
  | "INVALID_JSON"
  | "UNSUPPORTED_EXPORT"
  | "EMPTY_CONVERSATION"
  | "SINGLE_PARTICIPANT"
  | "TOO_LARGE"
  | "FILE_READ_FAILED"
  | "INVALID_REQUEST"
  | "CONSENT_REQUIRED"
  | "CONSENT_NOT_FOUND"
  | "CONSENT_CLOSED"
  | "CONSENT_NOT_WITHDRAWABLE"
  | "CONSENT_DECLINED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "PRODUCT_UNAVAILABLE"
  | "ENTITLEMENT_REQUIRED"
  | "PAYMENT_FAILED"
  | "JOB_LOCKED"
  | "CONVERSATION_TOO_LARGE"
  | "NOT_CONFIGURED"
  | "AI_TIMEOUT"
  | "AI_RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "AI_INVALID_RESPONSE"
  | "AI_REFUSED"
  | "NETWORK"
  | "RATE_LIMITED"
  | "PDF_FAILED"
  | "UNKNOWN";

export interface UserFacingError {
  code: AppErrorCode;
  /** Short sentence shown as the error headline. */
  message: string;
  /** Optional concrete next step the user can take. */
  hint?: string;
  /** True when retrying the same action has a realistic chance of working. */
  retryable: boolean;
}

const DEFAULTS: Record<AppErrorCode, { message: string; hint?: string; retryable: boolean }> = {
  INVALID_JSON: {
    message: "That file isn't valid JSON.",
    hint: "Export your chat again from Telegram Desktop using Format: JSON, then upload result.json.",
    retryable: false,
  },
  UNSUPPORTED_EXPORT: {
    message: "This doesn't look like a Telegram Desktop JSON export.",
    hint: "In Telegram Desktop open a chat → ⋮ → Export chat history → Format: Machine-readable JSON. Upload the result.json file it produces.",
    retryable: false,
  },
  EMPTY_CONVERSATION: {
    message: "This export doesn't contain any readable messages.",
    hint: "The MVP analyses text messages. An export made up entirely of media, calls or service events has nothing to read yet.",
    retryable: false,
  },
  SINGLE_PARTICIPANT: {
    message: "Only one participant sent messages in this export.",
    hint: "Conversation analysis compares two or more people. Try an export of a chat with replies from the other side.",
    retryable: false,
  },
  TOO_LARGE: {
    message: "That file is larger than this app can handle.",
    hint: "Try exporting a shorter date range from Telegram.",
    retryable: false,
  },
  FILE_READ_FAILED: {
    message: "The file couldn't be read.",
    hint: "Check the file still exists on your device and try again.",
    retryable: true,
  },
  INVALID_REQUEST: {
    message: "The analysis request was malformed and was rejected.",
    hint: "Reload the page and run the import again.",
    retryable: false,
  },
  CONSENT_REQUIRED: {
    message: "Analysis needs consent from every participant first.",
    hint: "Send a consent request to the other participant, and start the analysis once they have answered.",
    retryable: false,
  },
  CONSENT_NOT_FOUND: {
    message: "This consent link isn't valid.",
    hint: "Check you opened the most recent link. Links are single-purpose and can be replaced.",
    retryable: false,
  },
  CONSENT_CLOSED: {
    message: "This consent request has already been answered or has expired.",
    hint: "If you need to change your answer, ask for a new link.",
    retryable: false,
  },
  CONSENT_NOT_WITHDRAWABLE: {
    message: "There's no active consent on this link to withdraw.",
    retryable: false,
  },
  CONSENT_DECLINED: {
    message: "A participant declined, so this conversation can't be analysed.",
    hint: "Nothing was sent for AI analysis.",
    retryable: false,
  },
  UNAUTHORIZED: {
    message: "This isn't available to you.",
    hint: "Analyses are only visible in the browser that created them.",
    retryable: false,
  },
  NOT_FOUND: {
    message: "That isn't here.",
    hint: "It may have been deleted, or the link may be out of date.",
    retryable: false,
  },
  PRODUCT_UNAVAILABLE: {
    message: "That option isn't available yet.",
    retryable: false,
  },
  ENTITLEMENT_REQUIRED: {
    message: "This analysis hasn't been paid for yet.",
    hint: "Choose an option on the pricing step to unlock it.",
    retryable: false,
  },
  PAYMENT_FAILED: {
    message: "The payment couldn't be completed.",
    hint: "Nothing was charged. Try again, or pick a different option.",
    retryable: true,
  },
  JOB_LOCKED: {
    message: "This analysis is already running.",
    hint: "Wait for it to finish rather than starting a second one.",
    retryable: false,
  },
  CONVERSATION_TOO_LARGE: {
    message: "This conversation is larger than the selected option allows.",
    hint: "Pick an option with a higher message limit, or export a shorter date range.",
    retryable: false,
  },
  NOT_CONFIGURED: {
    message: "AI analysis isn't configured on this server.",
    hint: "An ANTHROPIC_API_KEY needs to be set in the server environment.",
    retryable: false,
  },
  AI_TIMEOUT: {
    message: "The analysis took too long and was stopped.",
    hint: "Large conversations take longer. Try again, or export a shorter date range.",
    retryable: true,
  },
  AI_RATE_LIMITED: {
    message: "The AI provider is rate-limiting requests right now.",
    hint: "Wait a minute and try again.",
    retryable: true,
  },
  AI_UNAVAILABLE: {
    message: "The AI provider is temporarily unavailable.",
    hint: "This is usually brief. Try again shortly.",
    retryable: true,
  },
  AI_INVALID_RESPONSE: {
    message: "The analysis came back in a shape we couldn't verify.",
    hint: "We retried automatically. Running the analysis again usually resolves it.",
    retryable: true,
  },
  AI_REFUSED: {
    message: "The AI provider declined to analyse this conversation.",
    hint: "This can happen with content that triggers the provider's safety systems.",
    retryable: false,
  },
  NETWORK: {
    message: "The connection dropped during analysis.",
    hint: "Check your connection and try again.",
    retryable: true,
  },
  RATE_LIMITED: {
    message: "Too many analyses started from here recently.",
    hint: "Wait a few minutes before starting another one.",
    retryable: true,
  },
  PDF_FAILED: {
    message: "The PDF couldn't be generated.",
    hint: "Use the print fallback to save the stats page as a PDF from your browser.",
    retryable: true,
  },
  UNKNOWN: {
    message: "Something went wrong.",
    hint: "Try again. If it keeps happening, re-import the conversation.",
    retryable: true,
  },
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly hint?: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(
    code: AppErrorCode,
    options: {
      /** Internal detail for server logs only - never sent to the browser. */
      detail?: string;
      message?: string;
      hint?: string;
      retryable?: boolean;
      status?: number;
      cause?: unknown;
    } = {},
  ) {
    const base = DEFAULTS[code];
    super(options.detail ?? base.message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.userMessage = options.message ?? base.message;
    this.hint = options.hint ?? base.hint;
    this.retryable = options.retryable ?? base.retryable;
    this.status = options.status ?? defaultStatus(code);
  }

  toUserFacing(): UserFacingError {
    return {
      code: this.code,
      message: this.userMessage,
      ...(this.hint ? { hint: this.hint } : {}),
      retryable: this.retryable,
    };
  }
}

function defaultStatus(code: AppErrorCode): number {
  switch (code) {
    case "INVALID_JSON":
    case "UNSUPPORTED_EXPORT":
    case "EMPTY_CONVERSATION":
    case "SINGLE_PARTICIPANT":
    case "INVALID_REQUEST":
    case "CONSENT_REQUIRED":
    case "CONSENT_CLOSED":
    case "CONSENT_NOT_WITHDRAWABLE":
    case "CONSENT_DECLINED":
    case "PRODUCT_UNAVAILABLE":
    case "CONVERSATION_TOO_LARGE":
    case "PAYMENT_FAILED":
      return 400;
    case "UNAUTHORIZED":
      return 403;
    case "CONSENT_NOT_FOUND":
    case "NOT_FOUND":
      return 404;
    case "ENTITLEMENT_REQUIRED":
      return 402;
    case "JOB_LOCKED":
      return 409;
    case "TOO_LARGE":
      return 413;
    case "RATE_LIMITED":
    case "AI_RATE_LIMITED":
      return 429;
    case "NOT_CONFIGURED":
      return 503;
    case "AI_TIMEOUT":
      return 504;
    case "AI_UNAVAILABLE":
    case "NETWORK":
      return 502;
    default:
      return 500;
  }
}

/** Narrows anything thrown into an AppError without leaking provider detail. */
export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError("UNKNOWN", {
    detail: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

/** Shape used by both the SSE stream and plain JSON error responses. */
export function errorResponseBody(error: unknown): { error: UserFacingError } {
  return { error: asAppError(error).toUserFacing() };
}
