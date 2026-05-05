/**
 * Sprint 3.0 v4 — in-memory token-bucket rate limiter.
 *
 * Sufficient for single-instance Railway. When Sprint 4.0 scales to
 * multi-instance, swap this for a Redis-backed limiter; the middleware
 * signature stays the same.
 *
 * Semantics: each unique key (defaulting to `req.ip`) gets `perMinute`
 * tokens in a sliding-restart bucket. First request in a minute refills
 * the bucket; subsequent requests decrement. When the bucket hits 0 the
 * limiter responds 429 with a `Retry-After` header and JSON body so the
 * verify page can render a soft "try again in X seconds" state.
 */

import type { Request, Response, NextFunction } from "express";

interface Bucket {
  tokens: number;
  /** Absolute epoch-ms at which the bucket refills. */
  refillAt: number;
}

/**
 * Module-level bucket map. Exported for tests so they can clear state
 * between cases — production paths never call this.
 */
export const _BUCKETS = new Map<string, Bucket>();

export interface RateLimiterOptions {
  perMinute: number;
  /** Override the per-request key (default: `req.ip`). */
  keyFn?: (req: Request) => string;
  /** Override the clock (test injection). Default: `Date.now`. */
  now?: () => number;
}

export function makeRateLimiter(options: RateLimiterOptions) {
  const { perMinute, keyFn, now = () => Date.now() } = options;
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn ? keyFn(req) : req.ip ?? "unknown";
    const t = now();
    let bucket = _BUCKETS.get(key);
    if (!bucket || t >= bucket.refillAt) {
      bucket = { tokens: perMinute, refillAt: t + 60_000 };
      _BUCKETS.set(key, bucket);
    }
    if (bucket.tokens <= 0) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.refillAt - t) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({ error: "Too many requests" });
    }
    bucket.tokens--;
    return next();
  };
}

/**
 * Preset for the invite-preview endpoint: 30 requests per IP per minute
 * per research `research-3.0-v4.md` §Rate limiting. Loose enough that
 * legitimate retries and auto-refresh are unaffected; tight enough to
 * cap an enumeration attack against the ~20-bit suffix space.
 */
export const previewRateLimit = makeRateLimiter({ perMinute: 30 });

/** Helper for tests: drop all bucket state. */
export function _clearRateLimitBuckets(): void {
  _BUCKETS.clear();
}
