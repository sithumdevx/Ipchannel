import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Channel } from "@/types/iptv";
import { FALLBACK_CHANNELS, parseM3U } from "@/lib/m3u-parser";

/**
 * Server-side channel catalogue.
 *
 * The live playlist is the primary source. The built-in catalogue is only a
 * bootstrap floor for the very first request on a brand-new instance — it is
 * never a cap, and the endpoint always returns every channel the active source
 * advertises once the source is reachable.
 *
 * Layers, in the order they are consulted:
 *
 *   1. In-memory catalogue  — a warm instance answers in microseconds.
 *   2. Disk snapshot        — survives instance recycling (see `PERSIST_FILE`),
 *                             so a cold start still serves the full live list.
 *   3. Upstream playlist    — fetched with a bounded wait, then written to disk.
 *   4. Built-in catalogue   — only when all of the above are unavailable.
 *
 * No layer on the request path ever blocks indefinitely, so a serverless
 * function can never be killed mid-response.
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

/**
 * How long a fetched catalogue is considered fresh — i.e. the in-memory / edge
 * cache window for the full live channel list.
 */
const CATALOG_TTL_MS = 10 * 60 * 1000;

/** Longest a single request will wait on the network before answering. */
const COLD_FETCH_BUDGET_MS = 8_000;

/** Hard abort for the upstream download itself. */
const UPSTREAM_FETCH_TIMEOUT_MS = 20_000;

/** Stops `?refresh=true` from hammering the upstream playlist. */
const REFRESH_MIN_INTERVAL_MS = 60_000;

const UPSTREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * On-disk snapshot of the last successful fetch.
 *
 * Serverless instances are recycled constantly; without this, every new instance
 * would restart from the built-in catalogue until its own download finished.
 * Persisting the parsed list means a recycled instance can serve all live
 * channels immediately. The path is intentionally instance-local scratch space
 * and is treated as a best-effort cache: all I/O is guarded.
 */
const PERSIST_FILE = join(tmpdir(), "streampulse-channels.json");
const PERSIST_VERSION = 2;

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
  /** The disk snapshot has been consulted at least once for this instance. */
  diskHydrated: boolean;
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
      diskHydrated: false,
    };
  }
  return scope[GLOBAL_KEY]!;
}

/* -------------------------------------------------------------------------- */
/* Disk snapshot (survives instance recycling)                                 */
/* -------------------------------------------------------------------------- */

/** Load the last good catalogue from disk into memory. Never throws. */
async function hydrateFromDisk(reg: CatalogState): Promise<void> {
  if (reg.diskHydrated || reg.channels) return;
  reg.diskHydrated = true;

  try {
    const raw = await readFile(PERSIST_FILE, "utf8");
    const snapshot = JSON.parse(raw) as {
      version?: number;
      fetchedAt?: number;
      channels?: Channel[];
    };

    if (snapshot?.version !== PERSIST_VERSION) return;
    if (!Array.isArray(snapshot.channels) || snapshot.channels.length === 0) return;

    // Another request may have populated memory while we were reading.
    if (!reg.channels) {
      reg.channels = snapshot.channels;
      reg.fetchedAt = typeof snapshot.fetchedAt === "number" ? snapshot.fetchedAt : 0;
    }
  } catch {
    // No snapshot yet, unreadable, or the host has no writable scratch space.
  }
}

/** Persist the catalogue for the next cold start. Never throws, never blocks. */
async function persistToDisk(channels: Channel[], fetchedAt: number): Promise<void> {
  try {
    await writeFile(
      PERSIST_FILE,
      JSON.stringify({ version: PERSIST_VERSION, fetchedAt, channels })
    );
  } catch {
    // Best effort: a read-only or full filesystem must not affect serving.
  }
}

/**
 * Default upstream playlist.
 *
 * The live playlist is the *primary* source, so this is used whenever
 * `STREAM_SOURCES` is not configured. Relying on the env var alone meant a
 * deployment without it silently served the built-in bootstrap list instead of
 * the 10,000+ live streams — exactly the failure this module exists to prevent.
 */
const DEFAULT_PLAYLIST_URL = "https://iptv-org.github.io/iptv/index.m3u";

/**
 * Upstream playlist source.
 *
 * Configured via `STREAM_SOURCES` (a comma-separated list of M3U/M3U8 URLs) so
 * the catalogue can be pointed at a different mirror or a private playlist; the
 * first entry is the primary source. Unset falls back to
 * `DEFAULT_PLAYLIST_URL`; set it to `none` to run purely on the built-in list.
 */
function playlistUrl(): string | null {
  const raw = process.env.STREAM_SOURCES?.trim();
  if (!raw) return DEFAULT_PLAYLIST_URL;
  if (raw.toLowerCase() === "none") return null;
  const first = raw.split(",")[0].trim();
  return first || DEFAULT_PLAYLIST_URL;
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

  // Mark the attempt before the request starts so concurrent/throttled callers
  // cannot queue a second download behind this one.
  reg.lastAttemptAt = Date.now();

  const refresh = (async () => {
    try {
      const channels = await fetchPlaylistSource(source);
      const state = catalogState();
      state.channels = channels;
      state.fetchedAt = Date.now();
      // Snapshot for the next cold start on this host.
      await persistToDisk(channels, state.fetchedAt);
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

  // A recycled instance may already have a full live snapshot on disk.
  if (!reg.channels) await hydrateFromDisk(reg);

  if (reg.channels && !isCatalogStale()) {
    return {
      channels: reg.channels,
      source: reg.fetchedAt === 0 ? "fallback" : "cache",
      fetchedAt: reg.fetchedAt,
      refreshing: reg.inFlight !== null,
    };
  }

  if (reg.channels) {
    // Stale but usable: answer now with the full list, refresh behind the
    // response (stale-while-revalidate).
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

  // Upstream is unreachable *and* there is no snapshot to serve: the built-in
  // catalogue keeps the app usable until a refresh succeeds. It is a floor, not
  // a cap — nothing truncates a live response.
  return {
    channels: FALLBACK_CHANNELS,
    source: "fallback",
    fetchedAt: 0,
    refreshing: reg.inFlight !== null,
  };
}

/**
 * Warm the catalogue without a request to ride on — used by the server startup
 * hook so a freshly booted instance begins downloading the live playlist before
 * the first visitor arrives, instead of making that visitor wait.
 *
 * Resolves once the in-memory catalogue is as good as it can be right now; it
 * never rejects and never leaves the process without a usable list.
 */
export async function warmCatalog(): Promise<void> {
  const reg = catalogState();
  if (!reg.channels) await hydrateFromDisk(reg);

  if (reg.channels && !isCatalogStale()) return;

  // Bounded so a slow upstream cannot delay instance readiness; whatever is not
  // finished here keeps running in the background.
  await settledWithin(scheduleCatalogRefresh(), COLD_FETCH_BUDGET_MS);
}
