import { NextRequest, NextResponse } from "next/server";

// In-memory segment cache to prevent re-fetching chunks and improve throughput
const segmentCache = new Map<string, { buffer: ArrayBuffer; contentType: string; cachedAt: number }>();
const MAX_CACHE_ENTRIES = 120;
const SEGMENT_CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

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

/**
 * Handle CORS Preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/**
 * Proxy stream manifests (.m3u8) to bypass browser CORS restrictions
 * Bypasses segments (.ts) directly to source by default for high throughput,
 * and caches any segments that pass through proxy.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");
  const forceProxySegments = searchParams.get("proxySegments") === "true";

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing 'url' query parameter" }, { status: 400 });
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
    if (!["http:", "https:"].includes(parsedTarget.protocol)) {
      return NextResponse.json({ error: "Invalid protocol. Only HTTP and HTTPS supported" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid target URL format" }, { status: 400 });
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
          "Content-Type": cached.contentType || "video/mp2t",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Cache-Control": "public, max-age=3600, immutable",
          "X-Proxy-Cache": "HIT",
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
    });

    if (!upstreamResponse.ok) {
      return new NextResponse(`Upstream returned ${upstreamResponse.status}`, {
        status: upstreamResponse.status,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const isM3U8 =
      targetUrl.includes(".m3u8") ||
      contentType.includes("application/vnd.apple.mpegurl") ||
      contentType.includes("application/x-mpegURL") ||
      contentType.includes("audio/x-mpegurl");

    // If it's a playlist, rewrite child playlists to route through proxy,
    // and let .ts video chunks load directly from source unless forceProxySegments is enabled.
    if (isM3U8) {
      const text = await upstreamResponse.text();
      const currentOrigin = request.nextUrl.origin;

      const lines = text.split(/\r?\n/);
      const rewrittenLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Rewrite encryption key URIs: #EXT-X-KEY:METHOD=...,URI="url"
        if (trimmed.startsWith("#EXT-X-KEY:")) {
          return trimmed.replace(/URI="([^"]+)"/, (_, keyUri) => {
            const absoluteKeyUrl = new URL(keyUri, targetUrl).toString();
            return `URI="${currentOrigin}/api/proxy?url=${encodeURIComponent(absoluteKeyUrl)}"`;
          });
        }

        // If line is a comment or metadata tag, preserve it
        if (trimmed.startsWith("#")) {
          return line;
        }

        // Resolve relative URL to absolute URL
        const absoluteUrl = new URL(trimmed, targetUrl).toString();

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
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    // If this is a media segment fetched through proxy, cache it and stream back
    const buffer = await upstreamResponse.arrayBuffer();
    const finalContentType = contentType || (targetUrl.includes(".ts") ? "video/mp2t" : "application/octet-stream");

    if (buffer.byteLength > 0 && buffer.byteLength < 8 * 1024 * 1024) {
      // Cache segments smaller than 8MB
      setCachedSegment(targetUrl, buffer, finalContentType);
    }

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    headers.set("Content-Type", finalContentType);
    headers.set("Content-Length", buffer.byteLength.toString());
    headers.set("Cache-Control", "public, max-age=3600, immutable");
    headers.set("X-Proxy-Cache", "MISS");

    return new NextResponse(buffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Proxy error for URL:", targetUrl, error);
    return NextResponse.json(
      { error: "Failed to fetch stream through proxy", details: (error as Error).message },
      {
        status: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  }
}
