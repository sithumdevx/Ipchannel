import { NextRequest, NextResponse } from "next/server";
import { fetchAndParseM3U, FALLBACK_CHANNELS } from "@/lib/m3u-parser";
import { Channel, ChannelsApiResponse } from "@/types/iptv";
import { matchesCountry } from "@/lib/countries";
import { cleanChannelTitle } from "@/lib/channel-display";
import {
  ensureHealthSweeper,
  filterLive,
  scheduleVerification,
} from "@/lib/stream-health";

// Global in-memory cache for ultra-fast serving of all parsed channels
let cachedChannels: Channel[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

// Abuse controls for the upstream playlist fetch:
//  - REFRESH_MIN_INTERVAL_MS stops `?refresh=true` from hammering the upstream
//    playlist on every request
//  - refreshInFlight collapses concurrent refreshes into one upstream request
const REFRESH_MIN_INTERVAL_MS = 60_000;
let refreshInFlight: Promise<void> | null = null;

// Input caps so a crafted query string cannot turn into a huge scan/allocation
const MAX_FILTER_LENGTH = 100;
const MAX_PAGE = 100_000;
const MAX_LIMIT = 500;

/**
 * Upstream playlist source.
 *
 * Configured via the `STREAM_SOURCES` environment variable (a comma-separated
 * list of M3U/M3U8 URLs) so the catalogue stays fully self-branded and the
 * source can be swapped without a code change. Falls back to the built-in
 * verified channel set when unset.
 */
function playlistUrl(): string | null {
  const raw = process.env.STREAM_SOURCES;
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  return first ? first : null;
}

function clampParam(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FILTER_LENGTH);
}

async function loadChannels(forceRefresh: boolean): Promise<"live" | "cache" | "fallback"> {
  const now = Date.now();
  const stale = !cachedChannels || now - lastCacheTime > CACHE_TTL_MS;
  const wantRefresh = forceRefresh && now - lastCacheTime >= REFRESH_MIN_INTERVAL_MS;

  if (!stale && !wantRefresh) return "cache";

  // Collapse stampedes: concurrent callers join the in-flight fetch instead of
  // each opening their own upstream connection.
  if (refreshInFlight) {
    await refreshInFlight;
    return cachedChannels ? "cache" : "fallback";
  }

  const requestedRefresh = wantRefresh;
  let fetchedFresh = false;

  refreshInFlight = (async () => {
    try {
      const source = playlistUrl();
      if (!source) {
        cachedChannels = cachedChannels || FALLBACK_CHANNELS;
        return;
      }
      const channels = await fetchAndParseM3U(source);
      if (channels && channels.length > 0) {
        cachedChannels = channels;
        lastCacheTime = Date.now();
        fetchedFresh = true;
      } else {
        cachedChannels = cachedChannels || FALLBACK_CHANNELS;
      }
    } catch {
      cachedChannels = cachedChannels || FALLBACK_CHANNELS;
    } finally {
      refreshInFlight = null;
    }
  })();

  await refreshInFlight;

  if (!cachedChannels) return "fallback";
  if (fetchedFresh && requestedRefresh) return "live";
  if (cachedChannels === FALLBACK_CHANNELS) return "fallback";
  return "cache";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const categoryParam = clampParam(searchParams.get("category"));
  const searchParam = clampParam(searchParams.get("search"));
  const countryParam = clampParam(searchParams.get("country"));
  const returnAll = searchParams.get("all") === "true";
  const forceRefresh = searchParams.get("refresh") === "true";

  const rawPage = Number.parseInt(searchParams.get("page") || "1", 10);
  const pageParam = Number.isFinite(rawPage)
    ? Math.min(Math.max(rawPage, 1), MAX_PAGE)
    : 1;

  const rawLimit = searchParams.get("limit")
    ? Number.parseInt(searchParams.get("limit")!, 10)
    : 0;
  const limitParam = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 0), MAX_LIMIT)
    : 0;

  const source = await loadChannels(forceRefresh);

  // Keep the 5-minute background verifier running on long-lived servers.
  ensureHealthSweeper();

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
    // Hide confirmed-dead streams and kick off background verification for a
    // bounded slice, so health converges over successive 5-minute windows
    // without this request ever blocking on network probes.
    const live = filterLive(allChannels);
    scheduleVerification(live.slice(0, 400));

    const response: ChannelsApiResponse = {
      channels: live,
      total: live.length,
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

  // Otherwise apply server-side filters if query params were passed
  let filtered = allChannels;

  if (categoryParam && categoryParam !== "All") {
    const catLower = categoryParam.toLowerCase();
    filtered = filtered.filter((ch) => ch.category.toLowerCase() === catLower);
  }

  if (countryParam && countryParam !== "All") {
    // Normalised comparison so "US", "us" and "United States" all match.
    filtered = filtered.filter((ch) => matchesCountry(ch.country, countryParam));
  }

  if (searchParam && searchParam.trim()) {
    const q = searchParam.toLowerCase().trim();
    filtered = filtered.filter(
      (ch) =>
        ch.name.toLowerCase().includes(q) ||
        cleanChannelTitle(ch.name).toLowerCase().includes(q) ||
        ch.category.toLowerCase().includes(q) ||
        (ch.country && ch.country.toLowerCase().includes(q)) ||
        (ch.language && ch.language.toLowerCase().includes(q))
    );
  }

  // Drop confirmed-dead streams *before* pagination so pages stay dense, then
  // schedule verification for what we're about to serve.
  filtered = filterLive(filtered);

  const total = filtered.length;

  // Pagination without artificial small cap
  let paginatedChannels = filtered;
  if (limitParam > 0) {
    const page = Math.max(1, pageParam);
    const startIndex = (page - 1) * limitParam;
    paginatedChannels = filtered.slice(startIndex, startIndex + limitParam);
  }

  scheduleVerification(paginatedChannels);

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
