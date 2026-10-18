import { NextRequest, NextResponse } from "next/server";
import { assertPublicHttpUrl } from "@/lib/security/url-guard";

// In-memory segment cache to prevent re-fetching chunks and improve throughput
const segmentCache = new Map<string, { buffer: ArrayBuffer; contentType: string; cachedAt: number }>();
const MAX_CACHE_ENTRIES = 120;
const SEGMENT_CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

// Upstream fetch hardening
const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024; // 4 MB
const MAX_SEGMENT_BYTES = 64 * 1024 * 1024; // 64 MB

/**
 * CORS is intentionally scoped to the StreamPulse origin itself.
 * The old `Access-Control-Allow-Origin: *` turned the proxy into a free
 * cross-origin relay that any third-party site could embed and abuse.
 * Same-origin playback needs no CORS header at all; we only echo one back
 * when the caller genuinely comes from this deployment.
 */
function sameOriginCorsHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const origin = request.headers.get("origin");
  if (origin && origin === request.nextUrl.origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

function redactUrl(rawUrl: string): string {
  // Log the shape of the request, never the (possibly signed) query string.
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function getCachedSegment(url: string) {
  const item = segmentCache.get(url);
  if (!item) return null;
  if (Date.now() - item.cachedAt > SEGMENT_CACHE_TTL_MS) {
    segmentCache.delete(url);
    return null;
  }
  return item;
}

function setCachedSegment(url: string, buffer: ArrayBuffer, contentType: string) {
  if (segmentCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = segmentCache.keys().next().value;
    if (oldestKey) segmentCache.delete(oldestKey);
  }
  segmentCache.set(url, { buffer, contentType, cachedAt: Date.now() });
}

function errorResponse(
  request: NextRequest,
  status: number,
  error: string
): NextResponse {
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        ...sameOriginCorsHeaders(request),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
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
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "Access-Control-Max-Age": "86400",
      "Access-Control-Allow-Private-Network": "false",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Proxy stream manifests (.m3u8) to bypass browser CORS restrictions.
 * Bypasses segments (.ts) directly to source by default for high throughput,
 * and caches any segments that pass through proxy.
 *
 * Security posture:
 *  - caller-supplied URLs are SSRF-checked (scheme, port, private IPs,
 *    DNS resolution) before any server-side fetch
 *  - same-origin only (Origin / Sec-Fetch-Site enforced in src/proxy.ts)
 *  - per-IP rate limiting in src/proxy.ts
 *  - upstream timeouts and response size caps
 *  - upstream errors are never echoed back to the client
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");
  const forceProxySegments = searchParams.get("proxySegments") === "true";

  if (!targetUrl) {
    return errorResponse(request, 400, "Missing 'url' query parameter");
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
    if (!["http:", "https:"].includes(parsedTarget.protocol)) {
      return errorResponse(request, 400, "Invalid protocol. Only HTTP and HTTPS supported");
    }
  } catch {
    return errorResponse(request, 400, "Invalid target URL format");
  }

  // Never proxy back into this deployment (request loops / internal probing).
  if (parsedTarget.host === request.nextUrl.host) {
    return errorResponse(request, 403, "Target not allowed");
  }

  // SSRF guard: private ranges, loopback, metadata endpoints, bad ports, DNS.
  const verdict = await assertPublicHttpUrl(targetUrl);
  if (!verdict.ok) {
    return errorResponse(request, 403, "Target not allowed");
  }

  // Check segment cache for video chunks
  const isSegment =
    targetUrl.includes(".ts") ||
    targetUrl.includes(".m4s") ||
    targetUrl.includes(".aac") ||
    targetUrl.includes(".mp4");

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
    const upstreamHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "*/*",
    };

    // Forward range requests if client sent one (useful for video chunks)
    const range = request.headers.get("range");
    if (range) {
      upstreamHeaders["Range"] = range;
    }

    const upstreamResponse = await fetch(targetUrl, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      redirect: "follow",
    });

    if (!upstreamResponse.ok) {
      // Do not leak upstream body/headers back to the caller.
      return errorResponse(request, 502, `Upstream returned ${upstreamResponse.status}`);
    }

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const declaredLength = Number(upstreamResponse.headers.get("content-length") || 0);
    const isM3U8 =
      targetUrl.includes(".m3u8") ||
      contentType.includes("application/vnd.apple.mpegurl") ||
      contentType.includes("application/x-mpegURL") ||
      contentType.includes("audio/x-mpegurl");

    // If it is a playlist, rewrite child playlists to route through proxy,
    // and let .ts video chunks load directly from source unless forceProxySegments is enabled.
    if (isM3U8) {
      const raw = await upstreamResponse.arrayBuffer();
      if (raw.byteLength > MAX_PLAYLIST_BYTES) {
        return errorResponse(request, 413, "Playlist too large");
      }

      const text = new TextDecoder().decode(raw);
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

        // If line is a comment or metadata tag, preserve it
        if (trimmed.startsWith("#")) {
          return line;
        }

        // Resolve relative URL to absolute URL
        let absoluteUrl: string;
        try {
          absoluteUrl = new URL(trimmed, targetUrl).toString();
        } catch {
          return line;
        }

        // Check if this line is a sub-manifest (.m3u8) or a video chunk (.ts, etc.)
        const isSubManifest =
          absoluteUrl.includes(".m3u8") ||
          absoluteUrl.includes("manifest") ||
          absoluteUrl.includes("playlist");

        if (isSubManifest || forceProxySegments) {
          // Proxy sub-manifests to avoid browser CORS on fetch/XHR
          const proxyParams = new URLSearchParams({ url: absoluteUrl });
          if (forceProxySegments) proxyParams.set("proxySegments", "true");
          return `${currentOrigin}/api/proxy?${proxyParams.toString()}`;
        }

        // For .ts video chunks: BYPASS PROXY! Let chunks stream directly from source CDN for max speed
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

    // Media segment fetched through the proxy: enforce a size cap, then cache
    // and stream back.
    if (declaredLength > MAX_SEGMENT_BYTES) {
      return errorResponse(request, 413, "Segment too large");
    }

    const buffer = await upstreamResponse.arrayBuffer();
    if (buffer.byteLength > MAX_SEGMENT_BYTES) {
      return errorResponse(request, 413, "Segment too large");
    }

    const finalContentType = contentType || (targetUrl.includes(".ts") ? "video/mp2t" : "application/octet-stream");

    // Only cache complete (200, non-range) responses so a ranged partial body
    // can never poison the cache and break playback.
    const isPartial = upstreamResponse.status === 206 || Boolean(range);
    if (!isPartial && buffer.byteLength > 0 && buffer.byteLength < 8 * 1024 * 1024) {
      setCachedSegment(targetUrl, buffer, finalContentType);
    }

    const headers = new Headers();
    Object.entries(sameOriginCorsHeaders(request)).forEach(([k, v]) => headers.set(k, v));
    headers.set("Content-Type", finalContentType);
    headers.set("Content-Length", buffer.byteLength.toString());
    headers.set("Cache-Control", isPartial ? "private, max-age=0, must-revalidate" : "public, max-age=3600, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Proxy-Cache", "MISS");

    return new NextResponse(buffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    // Log the endpoint only — never the full (possibly signed) source URL,
    // and never surface internal error details to the client.
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    console.error(
      "Proxy error:",
      redactUrl(targetUrl),
      isTimeout ? "(upstream timeout)" : error instanceof Error ? error.message : "unknown"
    );
    return errorResponse(
      request,
      isTimeout ? 504 : 502,
      "Failed to fetch stream through proxy"
    );
  }
}
