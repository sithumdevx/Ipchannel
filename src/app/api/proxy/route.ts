import { NextRequest, NextResponse } from "next/server";
import { assertPublicHttpUrl } from "@/lib/security/url-guard";

// In-memory segment cache to prevent re-fetching chunks and improve throughput
const segmentCache = new Map<string, { buffer: ArrayBuffer; contentType: string; cachedAt: number }>();
const MAX_CACHE_ENTRIES = 120;
const SEGMENT_CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

// Upstream fetch hardening.
//
// Manifests are tiny and must fail *fast*: a hanging origin used to hold the
// request open for 20s, which the player surfaced as a manifestLoaderError and
// the edge proxy eventually turned into a raw 502 Bad Gateway. A 5s budget lets
// the player recover (auto-fallback to the proxy, then auto-skip) promptly.
// Media segments carry the actual payload, so they get a longer budget.
const MANIFEST_TIMEOUT_MS = 5_000;
const SEGMENT_TIMEOUT_MS = 18_000;
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024; // 4 MB
const MAX_SEGMENT_BYTES = 64 * 1024 * 1024; // 64 MB

/**
 * User-agents used when talking to upstream stream origins.
 *
 * Many IPTV panels sniff the client UA and answer 403/401 to anything that does
 * not look like a real player. We always try the UA the browser sent first (so
 * account/referrer-locked streams keep working), then fall back through this
 * list before writing a stream off.
 */
const STREAM_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "VLC/3.0.20 LibVLC/3.0.20",
];

/** `.ts`, `.m4s`, `.aac`, `.mp4`, … — the media chunks rather than playlists. */
const SEGMENT_EXTENSION_RE = /\.(ts|m4s|aac|mp4|m4v|mp3|m4a|cmfv|cmfa)$/i;

/**
 * CORS is intentionally scoped to the StreamPulse origin itself.
 *
 * The old `Access-Control-Allow-Origin: *` turned the proxy into a free
 * cross-origin relay that any third-party site could embed and abuse.
 * Same-origin playback needs no CORS header at all, so we echo one back only
 * for callers from this deployment (and, when the browser omits `Origin` on a
 * same-origin GET, we echo our own origin so error responses still carry a
 * harmless, non-permissive CORS header).
 */
function sameOriginCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  const self = request.nextUrl.origin;

  if (origin && origin === self) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  if (!origin) {
    return { "Access-Control-Allow-Origin": self, Vary: "Origin" };
  }
  return {};
}

function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "[unparseable-url]";
  }
}

function getCachedSegment(url: string) {
  const cached = segmentCache.get(url);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > SEGMENT_CACHE_TTL_MS) {
    segmentCache.delete(url);
    return null;
  }
  return cached;
}

function setCachedSegment(url: string, buffer: ArrayBuffer, contentType: string) {
  if (segmentCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = segmentCache.keys().next().value;
    if (oldestKey) segmentCache.delete(oldestKey);
  }
  segmentCache.set(url, { buffer, contentType, cachedAt: Date.now() });
}

/**
 * Clean JSON error response.
 *
 * Never leaks upstream bodies/headers, always carries CORS + `no-store` headers,
 * and tags the result with `X-Proxy-Error` so the player (and logs) can tell a
 * proxy failure apart from a genuine 404 on a page route.
 */
function errorResponse(
  request: NextRequest,
  status: number,
  error: string,
  extra: Record<string, unknown> = {}
): NextResponse {
  return NextResponse.json(
    { error, ...extra },
    {
      status,
      headers: {
        ...sameOriginCorsHeaders(request),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Proxy-Error": "1",
      },
    }
  );
}

/**
 * Map an upstream failure status onto a clean response the client can action:
 *   401/403/404/410 — surfaced as-is (geo/UA locked, or genuinely gone)
 *   anything else (5xx, 429, …) — normalised to 502 with `retryable`
 */
function upstreamErrorResponse(request: NextRequest, upstreamStatus: number): NextResponse {
  const mapped =
    upstreamStatus === 404 ||
    upstreamStatus === 410 ||
    upstreamStatus === 401 ||
    upstreamStatus === 403
      ? upstreamStatus
      : 502;

  const message =
    mapped === 404
      ? "Stream source returned 404 (not found)."
      : mapped === 410
        ? "Stream source is gone (410)."
        : mapped === 401 || mapped === 403
          ? "Stream source refused the request (geo, user-agent or referrer locked)."
          : `Stream source is unavailable (upstream ${upstreamStatus}).`;

  return errorResponse(request, mapped, message, {
    upstreamStatus,
    retryable: upstreamStatus >= 500 || upstreamStatus === 429,
  });
}

type UpstreamResult =
  | { kind: "response"; response: Response }
  | { kind: "status"; status: number }
  | { kind: "timeout" }
  | { kind: "network" };

/**
 * Fetch an upstream stream with a hard timeout and a small user-agent fallback
 * chain. Returns a result object instead of throwing, so every failure mode is
 * mapped to a clean response by the caller.
 */
async function fetchUpstream(
  targetUrl: string,
  target: URL,
  request: NextRequest,
  range: string | null,
  timeoutMs: number
): Promise<UpstreamResult> {
  const clientUa = request.headers.get("user-agent");
  const clientLanguage = request.headers.get("accept-language");
  const clientReferer = request.headers.get("referer") ?? request.headers.get("referrer");

  const baseHeaders: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": clientLanguage || "en-US,en;q=0.9",
  };
  if (range) baseHeaders.Range = range;

  // Try the browser's UA first, then the portable fallbacks — de-duplicated.
  const candidates = Array.from(
    new Set([clientUa, ...STREAM_USER_AGENTS].filter((ua): ua is string => Boolean(ua)))
  );

  let lastStatus = 0;

  for (let i = 0; i < candidates.length; i++) {
    try {
      const response = await fetch(targetUrl, {
        headers: {
          ...baseHeaders,
          "User-Agent": candidates[i],
          // The first attempt mirrors what a direct player would send. Retries
          // switch to the stream's *own* origin, which satisfies the hotlink
          // checks most IPTV CDNs apply (a foreign referrer is a common 403).
          Referer: i === 0 ? clientReferer || `${target.origin}/` : `${target.origin}/`,
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
        // Live manifests/segments must never be served from Next's data cache.
        cache: "no-store",
      });

      if (response.ok) return { kind: "response", response };

      lastStatus = response.status;
      // Drain the body so the connection can be reused/closed promptly.
      try {
        await response.body?.cancel();
      } catch {
        /* ignore */
      }

      // Only user-agent/referrer-sensitive failures benefit from another try.
      const retryable =
        response.status === 401 || response.status === 403 || response.status === 406;
      if (!retryable) return { kind: "status", status: response.status };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        // A hanging origin should fail fast — never burn another attempt on it.
        return { kind: "timeout" };
      }
      // Connection reset / DNS / TLS — try the next UA before giving up.
    }
  }

  return lastStatus > 0 ? { kind: "status", status: lastStatus } : { kind: "network" };
}

/**
 * Handle CORS Preflight requests (only for same-origin callers).
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...sameOriginCorsHeaders(request),
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Accept, Accept-Language",
      "Access-Control-Max-Age": "86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Stream proxy.
 *
 * Rewrites HLS playlists so child manifests route back through the proxy while
 * letting media segments load directly from the source CDN for maximum speed.
 * Every failure is answered with clean JSON + CORS headers — this handler never
 * throws an unhandled error at the client.
 */
export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");
  const forceProxySegments = request.nextUrl.searchParams.get("proxySegments") === "true";

  if (!targetUrl) {
    return errorResponse(request, 400, "Missing required `url` parameter.");
  }

  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return errorResponse(request, 400, "Invalid target URL format.");
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return errorResponse(request, 400, "Invalid protocol. Only HTTP and HTTPS are supported.");
  }

  // Never proxy back into this deployment (request loops / internal probing).
  if (target.host === request.nextUrl.host) {
    return errorResponse(request, 403, "Target not allowed.");
  }

  // SSRF guard: private ranges, loopback, metadata endpoints, bad ports, DNS.
  // It is contractually non-throwing, but we guard it anyway so a future change
  // can never surface as an unhandled 500.
  let verdict: Awaited<ReturnType<typeof assertPublicHttpUrl>>;
  try {
    verdict = await assertPublicHttpUrl(targetUrl);
  } catch {
    return errorResponse(request, 403, "Target not allowed.");
  }
  if (!verdict.ok) {
    return errorResponse(request, 403, "Target not allowed.");
  }

  const isSegment = SEGMENT_EXTENSION_RE.test(target.pathname);

  // Segment cache lookup.
  if (isSegment) {
    const cached = getCachedSegment(targetUrl);
    if (cached) {
      return new NextResponse(cached.buffer, {
        status: 200,
        headers: {
          ...sameOriginCorsHeaders(request),
          "Content-Type": cached.contentType || "video/mp2t",
          "Cache-Control": "public, max-age=3600, immutable",
          "X-Proxy-Cache": "HIT",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  }

  try {
    const rangeHeader = request.headers.get("range");
    const timeoutMs = isSegment ? SEGMENT_TIMEOUT_MS : MANIFEST_TIMEOUT_MS;

    const upstream = await fetchUpstream(targetUrl, target, request, rangeHeader, timeoutMs);

    if (upstream.kind === "timeout") {
      console.warn("Proxy upstream timeout:", redactUrl(targetUrl));
      return errorResponse(request, 504, "Stream source timed out.", { retryable: true });
    }
    if (upstream.kind === "network") {
      console.warn("Proxy upstream unreachable:", redactUrl(targetUrl));
      return errorResponse(request, 502, "Stream source is unreachable.", { retryable: true });
    }
    if (upstream.kind === "status") {
      console.warn("Proxy upstream status:", redactUrl(targetUrl), upstream.status);
      return upstreamErrorResponse(request, upstream.status);
    }

    const upstreamResponse = upstream.response;
    const contentType = upstreamResponse.headers.get("content-type") || "";
    const declaredLength = Number(upstreamResponse.headers.get("content-length") || 0);
    const isM3U8 =
      target.pathname.toLowerCase().endsWith(".m3u8") ||
      contentType.includes("application/vnd.apple.mpegurl") ||
      contentType.includes("application/x-mpegurl") ||
      contentType.includes("audio/x-mpegurl") ||
      /(?:^|\.)m3u8(?:$|\?)/i.test(target.pathname);

    // --------------------------------------------------------------------- //
    // Playlist: rewrite child playlists through the proxy, keep media direct. //
    // --------------------------------------------------------------------- //
    if (isM3U8) {
      const raw = await upstreamResponse.arrayBuffer();
      if (raw.byteLength > MAX_PLAYLIST_BYTES) {
        return errorResponse(request, 413, "Playlist too large.");
      }

      const text = new TextDecoder().decode(raw);

      // A 200 that is actually an HTML error page (very common for dead IPTV
      // endpoints) must not be handed to hls.js as a manifest — that is what
      // produced the noisy manifestParsingError. Fail cleanly instead.
      if (!text.includes("#EXTM3U")) {
        console.warn("Proxy invalid manifest:", redactUrl(targetUrl));
        return errorResponse(request, 502, "Stream returned an invalid HLS manifest.", {
          retryable: true,
        });
      }

      const currentOrigin = request.nextUrl.origin;
      const lines = text.split(/\r?\n/);

      const rewrittenLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Rewrite encryption key URIs: #EXT-X-KEY:METHOD=...,URI="url"
        if (trimmed.startsWith("#EXT-X-KEY:")) {
          return trimmed.replace(/URI="([^"]+)"/, (_, keyUri) => {
            try {
              const absoluteKeyUrl = new URL(keyUri, targetUrl).toString();
              return `URI="${currentOrigin}/api/proxy?url=${encodeURIComponent(absoluteKeyUrl)}"`;
            } catch {
              return line;
            }
          });
        }

        // Preserve every other tag/comment untouched.
        if (trimmed.startsWith("#")) return line;

        // Resolve relative URLs against the manifest location.
        let absoluteUrl: string;
        try {
          absoluteUrl = new URL(trimmed, targetUrl).toString();
        } catch {
          return line;
        }

        const isSubManifest =
          absoluteUrl.includes(".m3u8") ||
          absoluteUrl.includes("manifest") ||
          absoluteUrl.includes("playlist");

        if (isSubManifest || forceProxySegments) {
          const proxyParams = new URLSearchParams({ url: absoluteUrl });
          if (forceProxySegments) proxyParams.set("proxySegments", "true");
          return `${currentOrigin}/api/proxy?${proxyParams.toString()}`;
        }

        // .ts / media chunks: let them stream straight from the source CDN.
        return absoluteUrl;
      });

      return new NextResponse(rewrittenLines.join("\n"), {
        status: 200,
        headers: {
          ...sameOriginCorsHeaders(request),
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // --------------------------------------------------------------------- //
    // Media segment fetched through the proxy: cap, cache and stream back.    //
    // --------------------------------------------------------------------- //
    if (declaredLength > MAX_SEGMENT_BYTES) {
      return errorResponse(request, 413, "Segment too large.");
    }

    const buffer = await upstreamResponse.arrayBuffer();
    if (buffer.byteLength > MAX_SEGMENT_BYTES) {
      return errorResponse(request, 413, "Segment too large.");
    }

    const finalContentType =
      contentType || (target.pathname.endsWith(".ts") ? "video/mp2t" : "application/octet-stream");

    // Only cache complete (200, non-range) responses so a ranged partial body
    // can never poison the cache and break playback.
    const isPartial = upstreamResponse.status === 206 || Boolean(rangeHeader);
    if (!isPartial && buffer.byteLength > 0 && buffer.byteLength < 8 * 1024 * 1024) {
      setCachedSegment(targetUrl, buffer, finalContentType);
    }

    const headers = new Headers();
    Object.entries(sameOriginCorsHeaders(request)).forEach(([key, value]) =>
      headers.set(key, value)
    );
    headers.set("Content-Type", finalContentType);
    headers.set("Content-Length", buffer.byteLength.toString());
    headers.set(
      "Cache-Control",
      isPartial ? "private, max-age=0, must-revalidate" : "public, max-age=3600, immutable"
    );
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Proxy-Cache", "MISS");

    return new NextResponse(buffer, { status: 200, headers });
  } catch (error) {
    // Log the endpoint only — never the full (possibly signed) source URL, and
    // never surface internal error details to the client.
    const isTimeout =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error(
      "Proxy error:",
      redactUrl(targetUrl),
      isTimeout ? "(upstream timeout)" : error instanceof Error ? error.message : "unknown"
    );
    return errorResponse(
      request,
      isTimeout ? 504 : 502,
      isTimeout ? "Stream source timed out." : "Failed to fetch stream through proxy.",
      { retryable: true }
    );
  }
}
