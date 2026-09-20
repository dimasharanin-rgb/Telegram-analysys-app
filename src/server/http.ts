/**
 * Route helpers.
 *
 * Every authenticated route goes through `withOwner`, so identity resolution,
 * the owner row, body-size limits, error translation and the "never leak an
 * internal message" rule are written once rather than in each handler.
 */

import { serverConfig } from "@/lib/config";
import { AppError, asAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { ensureOwner } from "@/server/repositories/owners";
import { resolveOwner } from "@/server/identity";

export interface OwnerContext {
  ownerId: string;
  request: Request;
  /** Set when a new identity was minted and must be returned to the browser. */
  setCookie?: string;
}

export function json(
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...init.headers,
    },
  });
}

export function errorResponse(error: unknown, headers: Record<string, string> = {}): Response {
  const appError = asAppError(error);
  if (appError.status >= 500) {
    log.error("http.error", { code: appError.code, detail: appError.message });
  }
  return json({ error: appError.toUserFacing() }, { status: appError.status, headers });
}

/** Reads and size-limits a JSON body. */
export async function readJson(request: Request, maxBytes?: number): Promise<unknown> {
  const limit = maxBytes ?? serverConfig().limits.maxAnalyzeRequestBytes;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) throw new AppError("TOO_LARGE");

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new AppError("INVALID_REQUEST");
  }
  if (text.length > limit) throw new AppError("TOO_LARGE");

  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("INVALID_REQUEST");
  }
}

export interface WithOwnerOptions {
  /** false rejects anonymous callers instead of minting an identity. */
  create?: boolean;
  /** Applies the shared per-caller rate limit. */
  rateLimit?: boolean;
}

type Handler = (context: OwnerContext) => Promise<Response>;

export function withOwner(handler: Handler, options: WithOwnerOptions = {}) {
  return async (request: Request): Promise<Response> => {
    try {
      if (options.rateLimit) {
        const config = serverConfig();
        const limit = checkRateLimit(
          clientKey(request.headers),
          config.limits.rateLimitMaxRequests,
          config.limits.rateLimitWindowMs,
        );
        if (!limit.allowed) {
          return errorResponse(new AppError("RATE_LIMITED"), {
            "retry-after": String(limit.retryAfterSeconds),
          });
        }
      }

      const owner = resolveOwner(request, {
        ...(options.create === false ? { create: false } : {}),
      });
      if (!owner) return errorResponse(new AppError("UNAUTHORIZED"));

      ensureOwner(owner.ownerId);

      const response = await handler({
        ownerId: owner.ownerId,
        request,
        ...(owner.setCookie ? { setCookie: owner.setCookie } : {}),
      });

      if (owner.setCookie) response.headers.append("set-cookie", owner.setCookie);
      return response;
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Pulls a route parameter out of Next's async params object. */
export async function routeParam(
  context: { params: Promise<Record<string, string | string[]>> },
  name: string,
): Promise<string> {
  const params = await context.params;
  const value = params[name];
  const single = Array.isArray(value) ? value[0] : value;
  if (!single) throw new AppError("NOT_FOUND");
  return single;
}
