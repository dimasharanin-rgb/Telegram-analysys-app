/**
 * Deliberately small logger.
 *
 * Conversation content is sensitive, so this module only ever accepts
 * structured, non-content fields. Values are scrubbed for anything that looks
 * like a credential before they are written, and free-form strings are capped
 * so a stray message body cannot end up in a log line.
 */

import { serverConfig } from "./config";

type Scalar = string | number | boolean | null | undefined;
type Fields = Record<string, Scalar>;

const SECRET_PATTERN = /\b(sk-ant-[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9]{16,}|Bearer\s+\S+)/gi;
const MAX_VALUE_LENGTH = 200;

function scrub(value: Scalar): Scalar {
  if (typeof value !== "string") return value;
  const redacted = value.replace(SECRET_PATTERN, "[redacted]");
  return redacted.length > MAX_VALUE_LENGTH
    ? `${redacted.slice(0, MAX_VALUE_LENGTH)}…`
    : redacted;
}

function emit(level: "info" | "warn" | "error", event: string, fields: Fields): void {
  const safe: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = scrub(value);
  }
  const line = JSON.stringify({ level, event, ...safe });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const log = {
  info: (event: string, fields: Fields = {}) => emit("info", event, fields),
  warn: (event: string, fields: Fields = {}) => emit("warn", event, fields),
  error: (event: string, fields: Fields = {}) => emit("error", event, fields),
  /** Only written when ANALYZER_DEBUG=1. Still content-free. */
  debug: (event: string, fields: Fields = {}) => {
    if (serverConfig().debug) emit("info", `debug.${event}`, fields);
  },
};
