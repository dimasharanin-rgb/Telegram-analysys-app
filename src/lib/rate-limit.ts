/**
 * Minimal in-process rate limiter.
 *
 * Enough to stop one browser tab (or one script) from burning through the
 * API budget. It is per-instance and resets on redeploy - a real deployment
 * behind multiple instances would move this to a shared store, which is a
 * swap of this module rather than a change to the routes.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  // Opportunistic cleanup keeps the map from growing without bound.
  if (buckets.size > 5_000) {
    for (const [existing, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(existing);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: maxRequests - bucket.count,
    retryAfterSeconds: 0,
  };
}

/** Best-effort client identity for rate limiting. Not used for anything else. */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "local";
}

/** Test seam. */
export function resetRateLimits(): void {
  buckets.clear();
}
