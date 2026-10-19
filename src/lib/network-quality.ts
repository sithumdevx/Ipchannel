import type {
  ConnectionQuality,
  ConnectionSource,
  ConnectionTier,
  NetworkSnapshot,
} from "@/types/diagnostics";

/**
 * Sri Lanka Network Friendly — connection quality estimation.
 *
 * Mobile networks here are the target case: heavily CGNAT'd 4G/LTE with a
 * round-trip that swings between 40 ms and 900 ms, and a downlink estimate that
 * can collapse by an order of magnitude between two fragments. Two consequences
 * shape this module:
 *
 *  1. **The weakest signal decides.** Averaging a good radio class with a bad
 *     measured round-trip produces a reassuring number that does not describe
 *     the experience. Every available signal is scored and the *minimum* wins,
 *     so the badge under-promises rather than over-promises.
 *  2. **A real measurement outranks an estimate, but never erases it.** The
 *     Network Information API is a coarse hint (Chrome alone implements it, and
 *     it reports the radio class rather than actual throughput). Our own probe
 *     is a genuine round trip. Both are used, and which one was decisive is
 *     reported through `ConnectionQuality.source`.
 *
 * Everything here is pure and free of React, so it can be reasoned about — and
 * tested — in isolation.
 */

/** Bars shown for each tier, out of four. */
const TIER_BARS: Record<ConnectionTier, number> = {
  excellent: 4,
  good: 3,
  fair: 2,
  poor: 1,
  offline: 0,
};

/** Badge copy per tier. */
const TIER_LABELS: Record<ConnectionTier, string> = {
  excellent: "Excellent (Stable)",
  good: "Good",
  fair: "Fair",
  poor: "Poor Connection",
  offline: "Offline",
};

/** Ordered worst → best, so a numeric score can be mapped back to a tier. */
const SCORE_TO_TIER: ConnectionTier[] = ["poor", "fair", "good", "excellent"];

/** Probes kept for the rolling median. Five smooths a single hiccup without
 *  hiding a sustained change in the link. */
export const LATENCY_SAMPLE_SIZE = 5;

/** The subset of the Network Information API this module reads. */
export interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

/**
 * The Network Information API, when the browser has it.
 *
 * Chrome/Edge/Opera on Android expose it; Safari and Firefox do not. Callers
 * must treat `null` as "no estimate available", never as "bad connection".
 */
export function getNetworkInformation(): NetworkInformationLike | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike;
    mozConnection?: NetworkInformationLike;
    webkitConnection?: NetworkInformationLike;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

/** Non-null only when the value is a finite, plausible measurement. */
function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Read the browser's own view of the network.
 *
 * Values are sanity-checked because the API is an estimate: `rtt: 0` and
 * `downlink: 0` are both reported in the wild and would otherwise score as a
 * dead link.
 */
export function readNetworkInfo(): Pick<
  NetworkSnapshot,
  "online" | "effectiveType" | "downlinkMbps" | "rttMs" | "saveData"
> {
  const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  const info = getNetworkInformation();

  return {
    online,
    effectiveType: typeof info?.effectiveType === "string" ? info.effectiveType : null,
    downlinkMbps: positive(info?.downlink),
    rttMs: positive(info?.rtt),
    saveData: info?.saveData === true,
  };
}

/**
 * Watch for network changes: radio-class changes and online/offline.
 *
 * Returns an unsubscribe function. Safe to call during SSR (does nothing).
 */
export function subscribeNetworkChanges(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);

  const info = getNetworkInformation();
  info?.addEventListener?.("change", listener);

  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
    info?.removeEventListener?.("change", listener);
  };
}

/**
 * Median of the recent probes.
 *
 * A median rather than a mean on purpose: one 3-second stall (background tab,
 * cell handover) should not drag the badge down for the next minute.
 */
export function medianOf(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : Math.round(sorted[mid]);
}

/**
 * Time a real round trip to our own origin.
 *
 * Measured around `fetch` rather than through `PerformanceResourceTiming` so a
 * single call is self-contained. `cache: "no-store"` plus the service worker's
 * existing `/api/` bypass guarantees the request actually leaves the device —
 * a cached reply would report ~0 ms and the badge would lie.
 *
 * Returns `null` when the probe fails or times out (treated as "no evidence",
 * never as "bad network" — an aborted probe on a backgrounded tab is normal).
 */
export async function measureLatency(url = "/api/ping", timeoutMs = 4000): Promise<number | null> {
  if (typeof performance === "undefined") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache" },
    });
    // A rate-limited or errored probe is not a latency sample.
    if (!response.ok) return null;
    return Math.round(performance.now() - started);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Score 0–3 for a measured round trip, in ms. */
function latencyScore(ms: number): number {
  if (ms <= 120) return 3;
  if (ms <= 250) return 2;
  if (ms <= 500) return 1;
  return 0;
}

/** Score 0–3 for the reported radio class, or `-1` when unrecognised. */
function effectiveTypeScore(type: string): number {
  switch (type.toLowerCase()) {
    case "4g":
      return 3;
    case "3g":
      return 2;
    case "2g":
      return 1;
    case "slow-2g":
      return 0;
    default:
      // "unknown", or a future radio class we do not know how to grade.
      return -1;
  }
}

/** Score 0–3 for the reported downlink estimate, in Mbps. */
function downlinkScore(mbps: number): number {
  if (mbps >= 5) return 3;
  if (mbps >= 2) return 2;
  if (mbps >= 0.8) return 1;
  return 0;
}

/** Score 0–3 for the reported round-trip estimate, in ms. */
function rttScore(ms: number): number {
  if (ms <= 100) return 3;
  if (ms <= 200) return 2;
  if (ms <= 400) return 1;
  return 0;
}

/**
 * Turn a network snapshot into a badge-ready verdict.
 *
 * Every available signal is scored and the weakest one wins, so the badge is
 * only "Excellent" when nothing disagrees. When a tier is decided purely by an
 * estimate the caller can tell, via `source`, that no real probe has landed yet.
 */
export function classifyConnection(snapshot: NetworkSnapshot): ConnectionQuality {
  if (!snapshot.online) {
    return {
      tier: "offline",
      label: TIER_LABELS.offline,
      hint: "This device reports no network connection.",
      bars: TIER_BARS.offline,
      source: "none",
    };
  }

  const scores: number[] = [];

  if (snapshot.latencyMs !== null) scores.push(latencyScore(snapshot.latencyMs));
  if (snapshot.downlinkMbps !== null) scores.push(downlinkScore(snapshot.downlinkMbps));
  if (snapshot.rttMs !== null) scores.push(rttScore(snapshot.rttMs));
  if (snapshot.effectiveType !== null) {
    const score = effectiveTypeScore(snapshot.effectiveType);
    if (score >= 0) scores.push(score);
  }

  const source: ConnectionSource =
    snapshot.latencyMs !== null
      ? "measured-latency"
      : scores.length > 0
        ? "network-information"
        : "none";

  if (scores.length === 0) {
    // Online, but nothing gradeable: either the browser exposes no network
    // details at all (Safari, Firefox) or the radio class it reported is one we
    // cannot score. Say only what is actually known — that the device believes
    // it is connected — rather than borrowing "Good" from a signal we never got.
    return {
      tier: "good",
      label: "Connected",
      hint:
        snapshot.probes > 0
          ? "Our probe isn't getting through — judging by the stream itself."
          : "This browser doesn't report network details — watching the stream itself.",
      bars: 2,
      source,
    };
  }

  const tier = SCORE_TO_TIER[Math.min(...scores)];
  return {
    tier,
    label: TIER_LABELS[tier],
    hint: describeEvidence(snapshot),
    bars: TIER_BARS[tier],
    source,
  };
}

/** Human-readable list of exactly what the verdict was built from. */
function describeEvidence(snapshot: NetworkSnapshot): string {
  const parts: string[] = [];

  if (snapshot.latencyMs !== null) parts.push(`${snapshot.latencyMs} ms ping`);
  if (snapshot.effectiveType) parts.push(snapshot.effectiveType.toUpperCase());
  if (snapshot.downlinkMbps !== null) parts.push(`~${snapshot.downlinkMbps} Mbps`);
  if (snapshot.rttMs !== null) parts.push(`~${snapshot.rttMs} ms RTT`);
  if (snapshot.saveData) parts.push("data saver on");

  return parts.length > 0 ? parts.join(" · ") : "No network information available.";
}

/** `"42 ms"`, or an em dash when there is nothing to show. */
export function formatLatency(ms: number | null): string {
  return ms === null ? "—" : `${ms} ms`;
}

/** Bitrate as a compact string: `1.2 Mbps`, `480 kbps`. */
export function formatBandwidth(bps: number | null): string {
  if (bps === null || bps <= 0) return "—";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}
