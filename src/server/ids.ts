import crypto from "node:crypto";

/**
 * Prefixed, opaque identifiers.
 *
 * The prefix makes an id readable in a log line or an error report without
 * revealing anything, and makes it obvious when the wrong kind of id has been
 * passed somewhere.
 */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export const nowIso = (): string => new Date().toISOString();
