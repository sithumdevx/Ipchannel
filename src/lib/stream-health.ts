import { Channel } from "@/types/iptv";

/**
 * Stream health verifier.
 *
 * Keeps a server-side registry of which stream URLs actually respond, so the
 * channel list can hide confirmed-dead streams and tag the rest with a live
 * indicator. Results are cached for HEALTH_TTL_MS (5 minutes), which is the
 * cadence at which streams are re-probed — both by the background sweeper and
 * by the `/api/health` cron endpoint.
 *
 * Why a cache instead of probing per request:
 *   - There are tens of thousands of channels; probing them all is impossible
 *     inside a serverless request. Instead we probe *lazily and bounded*: only
 *     the channels we are actually about to serve, never more than
 *     PROBE_BATCH_LIMIT per request, and never a URL we checked recently.
 *   - Confirmed-dead streams are filtered out of responses; anything unknown
 *     stays visible so a cold cache never blanks the app.
 *
 * The registry lives on `globalThis` so it survives Next.js dev-mode module
 * reloads (each reload would otherwise reset health state).
 */

export type StreamHealthStatus = "live" | "dead";

export interface StreamHealthEntry {
  status: StreamHealthStatus;
  /** Epoch ms of the last completed probe. */
  checkedAt: number;
}

/** Health records expire after 5 minutes and are re-probed on next use. */
export const HEALTH_TTL_MS = 5 * 60 * 1000;

/** Per-probe timeout. Streams that don't answer in this window are dead. */
const PROBE_TIMEOUT_MS = 4_000;

/** Upper bound of concurrent probes for a single request/sweep. */
const PROBE_CONCURRENCY = 16;

/** Never schedule more than this many fresh probes for one API response. */
const PROBE_BATCH_LIMIT = 48;

/** Cap the registry so a long-running process cannot grow without bound. */
const MAX_ENTRIES = 20_000;

/** Minimum gap between two background sweeps of the watch set. */
const SWEEP_MIN_INTERVAL_MS = 60_000;

interface StreamHealthRegistry {
  entries: Map<string, StreamHealthEntry>;
  /** URLs we intend to re-verify on the next sweep (most recent last). */
  watchSet: Set<string>;
  /** In-flight probes, keyed by URL, so concurrent callers share one request. */
  inFlight: Map<string, Promise<StreamHealthStatus>>;
  sweeperId: ReturnType<typeof setInterval> | null;
  lastSweepAt: number;
  /** URLs scheduled by the last background kick — used for coalescing. */
  pending: Set<string>;
}

function registry(): StreamHealthRegistry {
  const g = globalThis as typeof globalThis & {
    __streamHealthRegistry?: StreamHealthRegistry;
  };
  if (!g.__streamHealthRegistry) {
    g.__streamHealthRegistry = {
      entries: new Map(),
      watchSet: new Set(),
      inFlight: new Map(),
      sweeperId: null,
      lastSweepAt: 0,
      pending: new Set(),
    };
  }
  return g.__streamHealthRegistry;
}

/* -------------------------------------------------------------------------- */
/* Probing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Single probe against a stream URL.
 *
 * HLS/CDN endpoints frequently reject `HEAD`, so we fall back to a 2-byte range
 * `GET` — enough to prove the origin answers with real media bytes without
 * downloading the manifest. The body is discarded immediately.
 */
async function probeOnce(url: string): Promise<StreamHealthStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    let response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "StreamPulse-HealthCheck/1.0" },
      // Never let Next.js cache these probes — freshness is the whole point.
      cache: "no-store",
    });

    // 405/501 = method not allowed but the stream exists. Confirm with GET.
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "StreamPulse-HealthCheck/1.0",
          Range: "bytes=0-1",
        },
        cache: "no-store",
      });
      // We only needed the status line; stop reading the body.
      try {
        await response.body?.cancel();
      } catch {
        /* body already consumed/closed */
      }
    }

    if (response.ok || response.status === 206 || response.status === 304) {
      return "live";
    }
    // 401/403 often mean geo/auth walls the player also can't pass — treat as dead.
    return "dead";
  } catch {
    // Timeout, DNS failure, TLS error, blocked origin.
    return "dead";
  } finally {
    clearTimeout(timer);
  }
}

/** Probe a URL at most once at a time; concurrent callers share the result. */
export function probeStream(url: string): Promise<StreamHealthStatus> {
  const reg = registry();
  const existing = reg.inFlight.get(url);
  if (existing) return existing;

  const pending = probeOnce(url)
    .then((status) => {
      recordHealth(url, status);
      return status;
    })
    .finally(() => {
      reg.inFlight.delete(url);
    });

  reg.inFlight.set(url, pending);
  return pending;
}

/* -------------------------------------------------------------------------- */
/* Registry read/write                                                         */
/* -------------------------------------------------------------------------- */

function prune(reg: StreamHealthRegistry) {
  if (reg.entries.size <= MAX_ENTRIES) return;
  // Map preserves insertion order, so the oldest entries are pruned first.
  const overflow = reg.entries.size - MAX_ENTRIES;
  let i = 0;
  for (const key of reg.entries.keys()) {
    reg.entries.delete(key);
    reg.watchSet.delete(key);
    if (++i >= overflow) break;
  }
}

export function recordHealth(url: string, status: StreamHealthStatus) {
  const reg = registry();
  reg.entries.set(url, { status, checkedAt: Date.now() });
  reg.watchSet.add(url);
  prune(reg);
}

/** Fresh (within TTL) health for a URL, or `null` when unknown/stale. */
export function getHealth(url: string): StreamHealthEntry | null {
  const entry = registry().entries.get(url);
  if (!entry) return null;
  if (Date.now() - entry.checkedAt > HEALTH_TTL_MS) return null;
  return entry;
}

/**
 * Best-effort live flag for a channel.
 *
 * Unknown counts as live so the UI is never blank before the first probe lands;
 * confirmed-dead within the TTL is the only state that hides a channel.
 */
export function isChannelLive(channel: Channel): boolean {
  const entry = getHealth(channel.url);
  return entry ? entry.status === "live" : true;
}

/* -------------------------------------------------------------------------- */
/* Batch verification                                                          */
/* -------------------------------------------------------------------------- */

/** Run `fn` over `items` with a fixed concurrency ceiling. */
async function pooled<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

/**
 * Probe at most `limit` stale/unknown channels from `channels`.
 *
 * Fire-and-forget: results are written to the registry, so the *next* response
 * (or the next 5-minute sweep) reflects them. Returns the number of probes
 * actually scheduled.
 */
export function scheduleVerification(
  channels: Channel[],
  limit = PROBE_BATCH_LIMIT
): number {
  const reg = registry();
  let budget = limit;
  let scheduled = 0;

  for (const channel of channels) {
    if (budget <= 0) break;
    const url = channel.url;
    if (!url) continue;
    if (reg.inFlight.has(url) || reg.pending.has(url)) continue;
    if (getHealth(url)) continue; // still fresh

    reg.pending.add(url);
    budget--;
    scheduled++;

    void probeStream(url).finally(() => {
      reg.pending.delete(url);
    });
  }

  return scheduled;
}

/**
 * Verify a specific subset of channels *inline*, waiting for the results.
 * Used where the caller needs the answer now (e.g. `/api/health`).
 * Returns a map of url -> status for the channels that were probed.
 */
export async function verifyNow(
  channels: Channel[],
  limit = PROBE_CONCURRENCY * 4
): Promise<Map<string, StreamHealthStatus>> {
  const reg = registry();
  const results = new Map<string, StreamHealthStatus>();

  const stale = channels
    .filter((c) => c.url && !getHealth(c.url))
    .slice(0, limit);

  await pooled(stale, PROBE_CONCURRENCY, async (channel) => {
    const status = await probeStream(channel.url);
    results.set(channel.url, status);
  });

  // Also refresh anything in the batch that is live/dead but past its TTL.
  for (const channel of channels) {
    if (!channel.url || stale.includes(channel)) continue;
    const entry = reg.entries.get(channel.url);
    if (entry && Date.now() - entry.checkedAt > HEALTH_TTL_MS) {
      const status = await probeStream(channel.url);
      results.set(channel.url, status);
    }
  }

  return results;
}

/**
 * Drop channels confirmed dead within the TTL and stamp `isLive` on the rest.
 * Unknown channels are kept (see `isChannelLive`).
 */
export function filterLive(channels: Channel[]): Channel[] {
  const reg = registry();
  if (reg.entries.size === 0) return channels;

  const out: Channel[] = [];
  for (const channel of channels) {
    const entry = getHealth(channel.url);
    if (entry && entry.status === "dead") continue;
    out.push({ ...channel, isLive: entry ? entry.status === "live" : true });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Background sweeper                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Re-probe every URL in the watch set (the channels we have actually served
 * recently) so dead streams age out of the list within one TTL window.
 */
export async function sweepWatchSet(): Promise<{ checked: number; dead: number }> {
  const reg = registry();
  reg.lastSweepAt = Date.now();

  const now = Date.now();
  const stale = Array.from(reg.watchSet).filter((url) => {
    const entry = reg.entries.get(url);
    return !entry || now - entry.checkedAt > HEALTH_TTL_MS;
  });

  if (stale.length === 0) return { checked: 0, dead: 0 };

  let dead = 0;
  await pooled(stale, PROBE_CONCURRENCY, async (url) => {
    const status = await probeStream(url);
    if (status === "dead") dead++;
  });

  return { checked: stale.length, dead };
}

/**
 * Start the 5-minute background sweep if it isn't already running.
 *
 * Called lazily whenever the channels API is hit, so a long-lived Node server
 * (`next start`, Docker, a VM) keeps re-verifying streams on its own. On
 * serverless platforms background timers are unreliable, so `/api/health`
 * (driven by the cron in `vercel.json`) covers the same ground there.
 */
export function ensureHealthSweeper(): void {
  const reg = registry();
  if (reg.sweeperId !== null) return;
  if (process.env.NODE_ENV === "test") return;

  reg.sweeperId = setInterval(() => {
    // Never overlap sweeps, and skip if the cron endpoint just ran one.
    if (Date.now() - reg.lastSweepAt < SWEEP_MIN_INTERVAL_MS) return;
    void sweepWatchSet().catch(() => {
      /* a failed sweep is retried on the next tick */
    });
  }, HEALTH_TTL_MS);

  // Do not keep the Node process alive purely for the sweeper.
  reg.sweeperId.unref?.();
}

/** Point-in-time counters for the `/api/health` status endpoint. */
export function healthSummary() {
  const reg = registry();
  let live = 0;
  let dead = 0;
  const now = Date.now();
  for (const entry of reg.entries.values()) {
    if (now - entry.checkedAt > HEALTH_TTL_MS) continue;
    if (entry.status === "live") live++;
    else dead++;
  }
  return {
    live,
    dead,
    tracked: reg.entries.size,
    watching: reg.watchSet.size,
    lastSweepAt: reg.lastSweepAt,
    ttlMs: HEALTH_TTL_MS,
  };
}
