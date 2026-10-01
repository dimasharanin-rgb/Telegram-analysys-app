export type AiErrorCode =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "AUTHENTICATION"
  | "API_ERROR"
  | "CONNECTION"
  | "REFUSAL"
  | "TRUNCATED"
  | "MALFORMED";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}
