import type { Channel } from "@/types/iptv";
import { FALLBACK_CHANNELS, parseM3U } from "@/lib/m3u-parser";

/**
 * Server-side channel catalogue.
 *
 * The catalogue is the *only* thing `/api/channels` depends on, and by design it
 * never blocks a request on the network:
 *
 *   1. Warm + fresh  → served straight from the in-memory catalogue.
 *   2. Warm + stale  → served immediately, refreshed in the background
 *                      (stale-while-revalidate).
 *   3. Cold          → waits at most `COLD_FETCH_BUDGET_MS` for the upstream
 *                      playlist, then answers with the built-in catalogue while
 *                      the refresh keeps running.
 *
 * Why: serverless functions (Vercel defaults to a ~10s execution budget) are
 * routinely killed while downloading a multi-megabyte playlist. That turned into
 * a 504 for the client, which then only had a tiny placeholder list to show.
 * A bounded cold wait plus a large built-in catalogue means the API *always*
 * returns a full dataset in time, and simply upgrades to the live playlist on a
 * later request.
 *
 * State lives on `globalThis` so it survives Next.js dev-mode module reloads and
 * is shared by every route handler in a warm instance.
 */

export type CatalogSource = "live" | "cache" | "fallback";

export interface ChannelCatalog {
  channels: Channel[];
  source: CatalogSource;
  /** Epoch ms of the last successful upstream fetch (0 for the built-in set). */
  fetchedAt: number;
  /** A background refresh is in flight; a later request will see newer data. */
  refreshing: boolean;
}

/** Matches the playlist's own slow-moving cadence (playlists change rarely). */
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

/** Longest a single request will wait on the network before answering. */
const COLD_FETCH_BUDGET_MS = 6_000;

/** Hard abort for the upstream download itself. */
const UPSTREAM_FETCH_TIMEOUT_MS = 8_000;

/** Stops `?refresh=true` from hammering the upstream playlist. */
const REFRESH_MIN_INTERVAL_MS = 60_000;

const UPSTREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface CatalogState {
  channels: Channel[] | null;
  fetchedAt: number;
  inFlight: Promise<void> | null;
  lastAttemptAt: number;
  /**
   * True once a request has already spent the cold-start budget on the current
   * refresh attempt. Later requests answer from the built-in catalogue straight
   * away instead of queueing behind the same slow download.
   */
  coldWaitSpent: boolean;
}

const GLOBAL_KEY = "__streampulseCatalog";

function catalogState(): CatalogState {
  const scope = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: CatalogState;
  };
  if (!scope[GLOBAL_KEY]) {
    scope[GLOBAL_KEY] = {
      channels: null,
      fetchedAt: 0,
      inFlight: null,
      lastAttemptAt: 0,
      coldWaitSpent: false,
    };
  }
  return scope[GLOBAL_KEY]!;
}

/**
 * Upstream playlist source.
 *
 * Configured via `STREAM_SOURCES` (a comma-separated list of M3U/M3U8 URLs) so
 * the catalogue stays self-branded and the source can be swapped without a code
 * change.
 */
function playlistUrl(): string | null {
  const raw = process.env.STREAM_SOURCES;
  if (!raw) return null;
  const first = raw.split(",")[0].trim();
  return first || null;
}

/** Resolves when `promise` settles or `ms` elapses, whichever comes first. */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
    // Never hold the process open just for this timer.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchPlaylistSource(source: string): Promise<Channel[]> {
  const response = await fetch(source, {
    headers: {
      "User-Agent": UPSTREAM_USER_AGENT,
      Accept: "*/*",
    },
    // Deliberately uncached: the iptv-org index is ~3.4 MB, and Next's data
    // cache refuses anything over 2 MB ("items over 2MB can not be cached"), so
    // `next.revalidate` here only adds noise. Freshness is handled by this
    // module's own catalogue cache instead.
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTREAM_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`upstream responded ${response.status} ${response.statusText}`.trim());
  }

  const channels = parseM3U(await response.text());
  if (channels.length === 0) throw new Error("upstream playlist contained no channels");
  return channels;
}

/**
 * Start (or join) a refresh of the catalogue.
 *
 * Never throws and never rejects — callers can safely `void` the returned
 * promise. An attempt that ran within `REFRESH_MIN_INTERVAL_MS` is skipped so a
 * request loop cannot turn into an upstream hammer, which also means a
 * persistently unreachable playlist costs at most one download per minute.
 */
export function scheduleCatalogRefresh(): Promise<void> {
  const reg = catalogState();
  if (reg.inFlight) return reg.inFlight;
  if (reg.lastAttemptAt && Date.now() - reg.lastAttemptAt < REFRESH_MIN_INTERVAL_MS) {
    return Promise.resolve();
  }

  const source = playlistUrl();
  if (!source) {
    // No upstream configured — the built-in catalogue *is* the catalogue.
    if (!reg.channels) reg.channels = FALLBACK_CHANNELS;
    return Promise.resolve();
  }

  reg.lastAttemptAt = Date.now();

  const refresh = (async () => {
    try {
      const channels = await fetchPlaylistSource(source);
      const state = catalogState();
      state.channels = channels;
      state.fetchedAt = Date.now();
    } catch (error) {
      // Keep serving whatever we already have; the built-in catalogue is the
      // floor so the app is never empty.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[channels] playlist refresh failed (${source}): ${message}`);
    } finally {
      const state = catalogState();
      if (!state.channels) state.channels = FALLBACK_CHANNELS;
      state.inFlight = null;
      state.coldWaitSpent = false;
    }
  })();

  reg.inFlight = refresh;
  return refresh;
}

export function isCatalogStale(): boolean {
  const reg = catalogState();
  if (!reg.channels) return true;
  return Date.now() - reg.fetchedAt >= CATALOG_TTL_MS;
}

/**
 * Resolve the catalogue, waiting at most `COLD_FETCH_BUDGET_MS` on a cold start.
 * Never rejects and never returns an empty list.
 */
export async function getChannelCatalog(): Promise<ChannelCatalog> {
  const reg = catalogState();

  if (reg.channels && !isCatalogStale()) {
    return {
      channels: reg.channels,
      source: reg.fetchedAt === 0 ? "fallback" : "cache",
      fetchedAt: reg.fetchedAt,
      refreshing: reg.inFlight !== null,
    };
  }

  if (reg.channels) {
    // Stale but usable: answer now, refresh behind the response.
    void scheduleCatalogRefresh();
    return {
      channels: reg.channels,
      source: reg.fetchedAt === 0 ? "fallback" : "cache",
      fetchedAt: reg.fetchedAt,
      refreshing: true,
    };
  }

  // Cold start — the only path that waits, and only for a bounded slice.
  // Exactly one request per refresh attempt pays that wait: a second request
  // arriving while the same slow download is still running answers instantly
  // from the built-in catalogue instead of queueing behind it.
  let resolvedInTime = false;
  if (!reg.coldWaitSpent) {
    reg.coldWaitSpent = true;
    resolvedInTime = await settledWithin(scheduleCatalogRefresh(), COLD_FETCH_BUDGET_MS);
  }

  if (reg.channels) {
    return {
      channels: reg.channels,
      source: resolvedInTime && reg.fetchedAt > 0 ? "live" : "cache",
      fetchedAt: reg.fetchedAt,
      refreshing: reg.inFlight !== null,
    };
  }

  // Budget exhausted (or the fetch failed): serve the built-in catalogue while
  // the refresh continues, so the next request gets the live playlist.
  return {
    channels: FALLBACK_CHANNELS,
    source: "fallback",
    fetchedAt: 0,
    refreshing: reg.inFlight !== null,
  };
}
