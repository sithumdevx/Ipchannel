/**
 * In-memory fixed-window rate limiter.
 *
 * Used by `src/proxy.ts` to throttle API access per client IP and per
 * endpoint so a single client cannot flood the channel/proxy endpoints.
 *
 * NOTE: state lives in module scope, so it is scoped to a single
 * server/edge isolate. On serverless platforms each instance keeps its own
 * counters (soft limit). For a hard global limit, swap this module for a
 * shared store such as Upstash Redis — the exported API stays the same.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window resets (always >= 1 when blocked). */
  resetInSeconds: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();
const MAX_TRACKED_KEYS = 20_000;
let lastPurgeAt = 0;

/** Drop expired entries; bounded work so requests never stall. */
function purgeExpired(now: number): void {
  if (now - lastPurgeAt < 10_000 && windows.size < MAX_TRACKED_KEYS) return;
  lastPurgeAt = now;
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) windows.delete(key);
  }
  // Hard safety valve: never let a runaway key set exhaust memory.
  if (windows.size > MAX_TRACKED_KEYS) windows.clear();
}

/**
 * Count one request against `key`.
 * @param key     unique bucket (e.g. `proxy:203.0.113.7`)
 * @param limit   max requests allowed inside the window
 * @param windowMs window length in milliseconds
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  purgeExpired(now);

  const existing = windows.get(key);

  // First request of a fresh window.
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      resetInSeconds: Math.ceil(windowMs / 1000),
    };
  }

  existing.count += 1;
  const resetInSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count > limit) {
    return { allowed: false, limit, remaining: 0, resetInSeconds };
  }

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetInSeconds,
  };
}

/** Test helper — resets all counters. */
export function resetRateLimits(): void {
  windows.clear();
}
