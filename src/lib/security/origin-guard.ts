import type { NextRequest } from "next/server";

/**
 * Request-origin helpers used to stop other websites (and dumb scrapers)
 * from driving the StreamPulse API directly from a browser context.
 *
 * This is defence-in-depth, not authentication: a determined scraper can
 * spoof every header. Combined with rate limiting it removes the easy
 * automated abuse, while Supabase RLS remains the real access control for
 * user data.
 */

/** Extract the client IP, preferring the first hop of x-forwarded-for. */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "local";
}

export interface OriginCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * A request is considered first-party when:
 *  - `Origin` (if present) matches the request host, and
 *  - `Sec-Fetch-Site` (if the browser sent it) is `same-origin` or `none`.
 *
 * Non-browser clients omit both headers — they are still rate limited and
 * must still pass the server-side URL validation on each route.
 */
export function checkSameOrigin(request: NextRequest): OriginCheckResult {
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== request.nextUrl.host) {
        return { ok: false, reason: "cross-origin" };
      }
    } catch {
      return { ok: false, reason: "malformed-origin" };
    }
  }

  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return { ok: false, reason: `sec-fetch-site:${site}` };
  }

  return { ok: true };
}
