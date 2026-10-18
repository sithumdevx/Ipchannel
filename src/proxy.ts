import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { checkSameOrigin, getClientIp } from "@/lib/security/origin-guard";

/**
 * Security gate for every API request.
 *
 * Runs before the route handlers and enforces, in order:
 *   1. Same-origin policy (blocks other sites driving the API from a browser,
 *      and dumb cross-site scrapers) — `Sec-Fetch-Site` + `Origin` checks.
 *   2. Per-IP, per-endpoint rate limits (429 + `Retry-After` on abuse).
 *   3. `X-Robots-Tag: noindex, nofollow` on all API responses so search
 *      engines never index the endpoints.
 *
 * Note: Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts`.
 */

interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function policyFor(pathname: string): RateLimitPolicy {
  if (pathname.startsWith("/api/proxy")) {
    // Segment passthrough is high-frequency by design (≈10-60 req/min per
    // stream), so this bucket has to stay generous.
    return {
      limit: envInt("RATE_LIMIT_PROXY_PER_MIN", 600),
      windowMs: 60_000,
    };
  }
  if (pathname.startsWith("/api/channels")) {
    return {
      limit: envInt("RATE_LIMIT_CHANNELS_PER_MIN", 60),
      windowMs: 60_000,
    };
  }
  return {
    limit: envInt("RATE_LIMIT_API_PER_MIN", 120),
    windowMs: 60_000,
  };
}

function deny(
  status: number,
  error: string,
  extraHeaders: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        ...extraHeaders,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Route protection                                                            */
/* -------------------------------------------------------------------------- */

/** Routes that require an authenticated Supabase session. */
const PROTECTED_PATHS = ["/watch"];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

/**
 * Look for a Supabase auth session cookie.
 *
 * @supabase/ssr stores the session as `sb-<project-ref>-auth-token`, chunked
 * into `.0`, `.1`, … when it exceeds the cookie size limit. The presence of a
 * non-empty value is the signal; decoding JWT expiry here would duplicate
 * client logic and isn't required — the browser client re-validates on load.
 */
function findSessionCookie(request: NextRequest): boolean {
  const cookies = request.cookies.getAll();
  return cookies.some(
    (cookie) =>
      /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(cookie.name) &&
      cookie.value.trim().length > 0
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 0) Mandatory auth: /watch is login-gated at the edge. Without a Supabase
  //    session cookie the visitor is bounced to the landing page with
  //    ?signin=1, which auto-opens the auth modal. (Client-side AuthGate is
  //    the second line of defence, not the only one.)
  if (isProtectedPath(pathname)) {
    const session = findSessionCookie(request);
    if (!session) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/";
      redirect.search = "?signin=1";
      return NextResponse.redirect(redirect, { status: 307 });
    }
  }

  // 1) Cross-site requests may never touch the API from a browser context.
  const origin = checkSameOrigin(request);
  if (!origin.ok) {
    return deny(403, "Forbidden");
  }

  // 2) Rate limit per client IP and endpoint.
  const policy = policyFor(pathname);
  const ip = getClientIp(request);
  const bucket = `${pathname}:${ip}`;
  const result = checkRateLimit(bucket, policy.limit, policy.windowMs);

  if (!result.allowed) {
    return deny(429, "Too many requests", {
      "Retry-After": String(result.resetInSeconds),
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(result.resetInSeconds),
    });
  }

  // 3) Pass through with visibility headers for the client.
  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(result.resetInSeconds));
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");

  return response;
}

export const config = {
  matcher: ["/api/:path*", "/watch", "/watch/:path*"],
};
