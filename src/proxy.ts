import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { checkSameOrigin, getClientIp } from "@/lib/security/origin-guard";

/**
 * Security gate, running before the route handlers.
 *
 * Enforces, in order:
 *   0. Edge auth for `/watch` and `/admin` — visitors without a Supabase
 *      session cookie get a clean 307 redirect to `/?login=true` (which
 *      auto-opens the auth modal), never a raw JSON error body and never a
 *      streamed client-side redirect.
 *   1. Same-origin policy on `/api/*` (blocks other sites driving the API from
 *      a browser context, and dumb cross-site scrapers) — `Sec-Fetch-Site` +
 *      `Origin` checks. Never applied to page routes: cross-site navigations
 *      are legitimate browser traffic and always get a redirect instead.
 *   2. Per-IP, per-endpoint rate limits on `/api/*` (429 + `Retry-After`).
 *   3. `X-Robots-Tag: noindex, nofollow` on all responses so search engines
 *      never index the endpoints.
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

/** Routes that additionally require an administrator (checked in the page). */
const ADMIN_PATHS = ["/admin"];

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

/**
 * Is any administrator account configured?
 *
 * Deliberately re-derived here instead of imported from `@/lib/admin`: that
 * module pulls in `next/headers` and the Supabase server client, neither of
 * which belongs in the proxy runtime. The predicate only decides *whether it is
 * worth showing a sign-in form* — it never grants access, so a duplicate one
 * line check is a better trade than splitting the module.
 */
function adminsConfigured(): boolean {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .some((entry) => entry.trim().includes("@"));
}

/** Bounce to the landing page with the auth modal open. */
function loginRedirect(request: NextRequest): NextResponse {
  const redirect = request.nextUrl.clone();
  redirect.pathname = "/";
  redirect.search = "?login=true";
  return NextResponse.redirect(redirect, { status: 307 });
}

/**
 * Look for a Supabase auth session cookie.
 *
 * @supabase/ssr stores the session as `sb-<project-ref>-auth-token`, chunked
 * into `.0`, `.1`, … when it exceeds the cookie size limit. The presence of a
 * non-empty value is the signal; decoding JWT expiry here would duplicate
 * client logic and isn't required — the browser client re-validates on load.
 *
 * The project ref is matched loosely (`[a-z0-9-]+`, case-insensitive) so a
 * ref containing hyphens or an uppercase letter never causes a false
 * "logged out" bounce.
 */
function findSessionCookie(request: NextRequest): boolean {
  const cookies = request.cookies.getAll();
  return cookies.some(
    (cookie) =>
      /^sb-[a-z0-9-]+-auth-token(\.\d+)?$/i.test(cookie.name) &&
      cookie.value.trim().length > 0
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 0) Mandatory auth: /watch is login-gated at the edge. Without a Supabase
  //    session cookie the visitor is bounced to the landing page with
  //    ?login=true, which auto-opens the auth modal. This branch always
  //    answers with a *browser-friendly redirect* — never a raw JSON error —
  //    so visitors arriving from external links (Sec-Fetch-Site: cross-site)
  //    or via the Vercel preview/custom domains still get the sign-in flow.
  //    (Client-side AuthGate is the second line of defence, not the only one.)
  if (isProtectedPath(pathname)) {
    if (!findSessionCookie(request)) {
      return loginRedirect(request);
    }
  }

  // 0a) /admin gets the same edge gate, but only when an allowlist exists. With
  //     `ADMIN_EMAILS` unset there is no admin to sign in as, so the page's
  //     one-time setup instructions are more useful than a login form that
  //     cannot grant access — let the page render those instead.
  //
  //     This is a UX redirect, not the authorization check. It only proves *a*
  //     Supabase cookie exists; whether that cookie belongs to an administrator
  //     is decided inside the page and re-decided on every `/api/admin/*`
  //     request. Without it, an anonymous visit would be answered by a streamed
  //     client-side redirect (a 200 with an error shell), which is slower and
  //     flashes an error page before landing.
  if (isAdminPath(pathname) && adminsConfigured() && !findSessionCookie(request)) {
    return loginRedirect(request);
  }

  // 1) API hardening — origin & rate-limit checks only apply to /api/*.
  //    Page routes (like /watch) are excluded on purpose: browsers following
  //    cross-site links legitimately send `Sec-Fetch-Site: cross-site` on
  //    navigations, and answering those with `{"error":"Forbidden"}` JSON was
  //    the auth-redirect bug reported on https://ipstreampulse.vercel.app.
  if (pathname.startsWith("/api/")) {
    // 1a) Cross-site requests may never touch the API from a browser context.
    const origin = checkSameOrigin(request);
    if (!origin.ok) {
      return deny(403, "Forbidden");
    }

    // 1b) Rate limit per client IP and endpoint.
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

    // 2) API pass-through — surface the rate-limit budget so well-behaved
    //    clients can back off before hitting the ceiling.
    const apiResponse = NextResponse.next();
    apiResponse.headers.set("X-RateLimit-Limit", String(result.limit));
    apiResponse.headers.set("X-RateLimit-Remaining", String(result.remaining));
    apiResponse.headers.set("X-RateLimit-Reset", String(result.resetInSeconds));
    apiResponse.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    apiResponse.headers.set("Referrer-Policy", "no-referrer");
    apiResponse.headers.set("X-Content-Type-Options", "nosniff");
    return apiResponse;
  }

  // 2) Page pass-through with baseline visibility headers for the client.
  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");

  return response;
}

export const config = {
  matcher: ["/api/:path*", "/watch", "/watch/:path*", "/admin", "/admin/:path*"],
};
