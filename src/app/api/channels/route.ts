import { after, NextRequest, NextResponse } from "next/server";
import type { ChannelsApiResponse } from "@/types/iptv";
import { matchesCountry } from "@/lib/countries";
import { cleanChannelTitle } from "@/lib/channel-display";
import {
  getChannelCatalog,
  isCatalogStale,
  scheduleCatalogRefresh,
} from "@/lib/channels";
import { ensureHealthSweeper, filterLive, runVerification } from "@/lib/stream-health";

/**
 * Execution budget for the function.
 *
 * The catalogue itself never waits more than its own cold-start budget (~8s), so
 * this headroom exists purely for the deferred `after()` work — refreshing the
 * playlist and probing streams — which should not be cut short mid-flight.
 * 60s is within every current Vercel plan's ceiling.
 */
export const maxDuration = 60;

// Input caps so a crafted query string cannot turn into a huge scan/allocation
const MAX_FILTER_LENGTH = 100;
const MAX_PAGE = 100_000;

/**
 * Sanity bound for explicitly paginated requests only.
 *
 * Omitting `limit` (or passing `all=true`) returns the *entire* catalogue. This
 * exists purely so a crafted `limit` cannot ask for a nonsense slice size; it is
 * set far above any real playlist length so it never truncates live channels.
 */
const MAX_LIMIT = 100_000;

/**
 * Streams a single response will queue for background health verification.
 * Small enough that the deferred probes finish inside `maxDuration` even when
 * every origin in the batch times out (48 / 16 concurrent × 8s ≈ 24s).
 *
 * This only bounds *verification*, never the channel list itself.
 */
const VERIFY_BATCH = 48;

function clampParam(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FILTER_LENGTH);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const categoryParam = clampParam(searchParams.get("category"));
  const searchParam = clampParam(searchParams.get("search"));
  const countryParam = clampParam(searchParams.get("country"));
  const returnAll = searchParams.get("all") === "true";
  const forceRefresh = searchParams.get("refresh") === "true";

  const rawPage = Number.parseInt(searchParams.get("page") || "1", 10);
  const pageParam = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), MAX_PAGE) : 1;

  const rawLimit = searchParams.get("limit")
    ? Number.parseInt(searchParams.get("limit")!, 10)
    : 0;
  const limitParam = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 0), MAX_LIMIT)
    : 0;

  // Bounded: returns the live playlist, a warm cache, or the built-in catalogue —
  // never an empty list and never a serverless timeout.
  const catalog = await getChannelCatalog();
  const allChannels = catalog.channels;

  // `?refresh=true` asks for a fresh download; the catalogue's own throttle stops
  // that from becoming an upstream hammer, and it never blocks this response.
  if (forceRefresh) void scheduleCatalogRefresh();

  // Keep the 5-minute background verifier running on long-lived servers.
  ensureHealthSweeper();

  // Extract unique categories and countries across the entire catalogue
  const categorySet = new Set<string>();
  const countrySet = new Set<string>();

  for (let i = 0; i < allChannels.length; i++) {
    const ch = allChannels[i];
    if (ch.category) categorySet.add(ch.category);
    if (ch.country) countrySet.add(ch.country);
  }

  const categories = Array.from(categorySet).sort();
  const countries = Array.from(countrySet).sort();

  const headers = {
    // Cache the *full* live channel list at the edge for 5 minutes (with a
    // 10-minute stale-while-revalidate tail) so visitors get all active streams
    // without each request touching the function or the upstream playlist.
    // A degraded (bootstrap) response expires quickly instead, so the CDN
    // re-checks as soon as the instance has warmed its live playlist — one cold
    // start must never pin a short list for every visitor.
    "Cache-Control":
      catalog.source === "fallback"
        ? "public, s-maxage=30, stale-while-revalidate=120"
        : "public, s-maxage=300, stale-while-revalidate=600",
  };

  // Deferred work: everything that must not delay (or break) the response.
  // `after()` keeps the platform from freezing the function while it runs.
  const deferWork = (toVerify: typeof allChannels) => {
    after(async () => {
      if (isCatalogStale()) await scheduleCatalogRefresh();
      await runVerification(toVerify, VERIFY_BATCH);
    });
  };

  if (returnAll) {
    // Hide confirmed-dead streams; health converges over successive 5-minute
    // windows without this request ever blocking on network probes.
    const live = filterLive(allChannels);
    deferWork(live);

    const response: ChannelsApiResponse = {
      channels: live,
      total: live.length,
      categories,
      countries,
      source: catalog.source,
    };

    return NextResponse.json(response, { headers });
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

  // Drop confirmed-dead streams *before* pagination so pages stay dense.
  filtered = filterLive(filtered);

  const total = filtered.length;

  // Pagination without artificial small cap
  let paginatedChannels = filtered;
  if (limitParam > 0) {
    const page = Math.max(1, pageParam);
    const startIndex = (page - 1) * limitParam;
    paginatedChannels = filtered.slice(startIndex, startIndex + limitParam);
  }

  deferWork(paginatedChannels);

  const response: ChannelsApiResponse = {
    channels: paginatedChannels,
    total,
    categories,
    countries,
    source: catalog.source,
  };

  return NextResponse.json(response, { headers });
}
