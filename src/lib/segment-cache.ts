/**
 * HLS segment cache.
 *
 * Media segments are the bulk of proxied bytes, and HLS clients re-request the
 * same chunk aggressively — during a seek, across ABR level switches, and from a
 * second tab watching the same stream. Caching a bounded number of segments
 * removes most of that duplicate upstream traffic.
 *
 * It lives in its own module rather than inside the proxy route so the admin
 * console can inspect and clear it without importing a route handler.
 *
 * Deliberately in-memory and per-instance: a shared cache would need a network
 * hop on the playback path, which costs more than the traffic it saves at this
 * size. State is on `globalThis` so Next.js dev-mode module reloads do not
 * silently drop it.
 */

/** Upper bound on retained segments. */
const MAX_CACHE_ENTRIES = 120;

/** Segments are immutable, so they can be held for a while. */
const SEGMENT_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedSegment {
  buffer: ArrayBuffer;
  contentType: string;
  cachedAt: number;
}

interface SegmentCacheState {
  entries: Map<string, CachedSegment>;
  /** Cache hits/misses since boot, for the admin console's hit-rate figure. */
  hits: number;
  misses: number;
}

function cacheState(): SegmentCacheState {
  const g = globalThis as typeof globalThis & { __streamPulseSegmentCache?: SegmentCacheState };
  if (!g.__streamPulseSegmentCache) {
    g.__streamPulseSegmentCache = { entries: new Map(), hits: 0, misses: 0 };
  }
  return g.__streamPulseSegmentCache;
}

/** Fresh cached segment, or `null` (also counts the miss). */
export function getCachedSegment(url: string): CachedSegment | null {
  const state = cacheState();
  const cached = state.entries.get(url);

  if (!cached || Date.now() - cached.cachedAt > SEGMENT_CACHE_TTL_MS) {
    if (cached) state.entries.delete(url);
    state.misses++;
    return null;
  }

  state.hits++;
  return cached;
}

/** Store a segment, evicting the oldest entry when the cache is full. */
export function setCachedSegment(url: string, buffer: ArrayBuffer, contentType: string) {
  const state = cacheState();

  if (state.entries.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = state.entries.keys().next().value;
    if (oldestKey) state.entries.delete(oldestKey);
  }

  state.entries.set(url, { buffer, contentType, cachedAt: Date.now() });
}

export interface SegmentCacheStats {
  entries: number;
  capacity: number;
  /** Approximate retained bytes (the actual buffer payload). */
  bytes: number;
  hits: number;
  misses: number;
  /** Hits ÷ (hits + misses), 0–1. 0 when nothing has been served yet. */
  hitRate: number;
  ttlMs: number;
}

export function segmentCacheStats(): SegmentCacheStats {
  const state = cacheState();
  let bytes = 0;
  for (const entry of state.entries.values()) bytes += entry.buffer.byteLength;

  const total = state.hits + state.misses;

  return {
    entries: state.entries.size,
    capacity: MAX_CACHE_ENTRIES,
    bytes,
    hits: state.hits,
    misses: state.misses,
    hitRate: total === 0 ? 0 : state.hits / total,
    ttlMs: SEGMENT_CACHE_TTL_MS,
  };
}

/** Drop every cached segment and reset the hit counters. */
export function clearSegmentCache(): { cleared: number; bytes: number } {
  const state = cacheState();
  const cleared = state.entries.size;
  let bytes = 0;
  for (const entry of state.entries.values()) bytes += entry.buffer.byteLength;

  state.entries.clear();
  state.hits = 0;
  state.misses = 0;

  return { cleared, bytes };
}
