import { NextRequest, NextResponse } from "next/server";
import { fetchAndParseM3U, FALLBACK_CHANNELS } from "@/lib/m3u-parser";
import { Channel, ChannelsApiResponse } from "@/types/iptv";

// Global in-memory cache for ultra-fast serving of all parsed channels
let cachedChannels: Channel[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const categoryParam = searchParams.get("category");
  const searchParam = searchParams.get("search");
  const countryParam = searchParams.get("country");
  const returnAll = searchParams.get("all") === "true";
  const forceRefresh = searchParams.get("refresh") === "true";
  const pageParam = parseInt(searchParams.get("page") || "1", 10);
  const limitParam = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 0;

  const now = Date.now();
  let source: "live" | "cache" | "fallback" = "cache";

  // Check if cache needs refreshing or initial load
  if (!cachedChannels || forceRefresh || now - lastCacheTime > CACHE_TTL_MS) {
    try {
      const channels = await fetchAndParseM3U("https://iptv-org.github.io/iptv/index.m3u");
      if (channels && channels.length > 0) {
        cachedChannels = channels;
        lastCacheTime = now;
        source = forceRefresh ? "live" : "cache";
      } else {
        cachedChannels = FALLBACK_CHANNELS;
        source = "fallback";
      }
    } catch {
      cachedChannels = cachedChannels || FALLBACK_CHANNELS;
      source = "fallback";
    }
  }

  const allChannels = cachedChannels || FALLBACK_CHANNELS;

  // Extract unique categories and countries across the entire parsed list
  const categorySet = new Set<string>();
  const countrySet = new Set<string>();

  for (let i = 0; i < allChannels.length; i++) {
    const ch = allChannels[i];
    if (ch.category) categorySet.add(ch.category);
    if (ch.country) countrySet.add(ch.country);
  }

  const categories = Array.from(categorySet).sort();
  const countries = Array.from(countrySet).sort();

  // If client wants all channels (for client-side virtualization and instant search)
  if (returnAll) {
    const response: ChannelsApiResponse = {
      channels: allChannels,
      total: allChannels.length,
      categories,
      countries,
      source,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200",
      },
    });
  }

  // Otherwise apply server-side filters if query params were passed
  let filtered = allChannels;

  if (categoryParam && categoryParam !== "All") {
    const catLower = categoryParam.toLowerCase();
    filtered = filtered.filter((ch) => ch.category.toLowerCase() === catLower);
  }

  if (countryParam && countryParam !== "All") {
    const countryLower = countryParam.toLowerCase();
    filtered = filtered.filter((ch) => ch.country?.toLowerCase() === countryLower);
  }

  if (searchParam && searchParam.trim()) {
    const q = searchParam.toLowerCase().trim();
    filtered = filtered.filter(
      (ch) =>
        ch.name.toLowerCase().includes(q) ||
        ch.category.toLowerCase().includes(q) ||
        (ch.country && ch.country.toLowerCase().includes(q)) ||
        (ch.language && ch.language.toLowerCase().includes(q))
    );
  }

  const total = filtered.length;

  // Pagination without artificial small cap
  let paginatedChannels = filtered;
  if (limitParam > 0) {
    const page = Math.max(1, pageParam);
    const startIndex = (page - 1) * limitParam;
    paginatedChannels = filtered.slice(startIndex, startIndex + limitParam);
  }

  const response: ChannelsApiResponse = {
    channels: paginatedChannels,
    total,
    categories,
    countries,
    source,
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
