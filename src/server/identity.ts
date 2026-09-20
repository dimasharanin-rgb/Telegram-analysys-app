/**
 * Owner identity.
 *
 * Not an account system. Every request carries a signed, HTTP-only cookie
 * holding an opaque owner id; rows are stamped with it and every read is
 * filtered by it. That is what makes "this analysis is mine" enforceable
 * rather than decorative, without asking anyone to create a password.
 *
 * When real authentication is added, `resolveOwner()` is the single place that
 * changes: everything downstream only ever sees an owner id.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { log } from "@/lib/logger";

export const OWNER_COOKIE = "ca_owner";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

let cachedSecret: string | null = null;

/**
 * The signing secret. Production must set APP_SECRET; for local development a
 * secret is generated once and kept beside the database so restarts do not
 * invalidate everyone's identity.
 */
function secret(): string {
  if (cachedSecret) return cachedSecret;

  const configured = process.env.APP_SECRET?.trim();
  if (configured && configured.length >= 16) {
    cachedSecret = configured;
    return cachedSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET must be set in production");
  }

  const file = path.join(process.cwd(), "data", ".app-secret");
  try {
    cachedSecret = fs.readFileSync(file, "utf8").trim();
    if (cachedSecret.length >= 16) return cachedSecret;
  } catch {
    // Fall through and create one.
  }

  cachedSecret = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, cachedSecret, { mode: 0o600 });
    log.warn("identity.dev_secret_generated", { file });
  } catch {
    log.warn("identity.dev_secret_ephemeral", {});
  }
  return cachedSecret;
}

/** Test seam. */
export function resetIdentitySecret(): void {
  cachedSecret = null;
}

function sign(value: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(value)
    .digest("base64url");
}

export function issueOwnerToken(ownerId: string): string {
  return `${ownerId}.${sign(ownerId)}`;
}

/** Returns the owner id only when the signature checks out. */
export function verifyOwnerToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const ownerId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^[0-9a-f-]{16,64}$/i.test(ownerId)) return null;

  const expected = sign(ownerId);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? ownerId : null;
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function ownerCookieHeader(ownerId: string): string {
  const parts = [
    `${OWNER_COOKIE}=${issueOwnerToken(ownerId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export interface ResolvedOwner {
  ownerId: string;
  /** Set when a new identity was issued and the response must carry it. */
  setCookie?: string;
}

/**
 * Reads the owner from the request, or mints a new one.
 *
 * `create: false` is used by endpoints that should not hand out an identity to
 * an anonymous caller - they answer 401 instead.
 */
export function resolveOwner(
  request: Request,
  options: { create?: boolean } = {},
): ResolvedOwner | null {
  const cookies = parseCookies(request.headers.get("cookie"));
  const existing = verifyOwnerToken(cookies[OWNER_COOKIE]);
  if (existing) return { ownerId: existing };
  if (options.create === false) return null;

  const ownerId = crypto.randomUUID();
  return { ownerId, setCookie: ownerCookieHeader(ownerId) };
}
