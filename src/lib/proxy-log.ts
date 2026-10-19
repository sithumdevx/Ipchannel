import type { AdminProxyError, AdminProxyStatus } from "@/types/admin";
import { httpStatusLabel, recordRequest } from "@/lib/metrics";

/**
 * Rolling proxy telemetry.
 *
 * The stream proxy is the part of StreamPulse most likely to break — upstream
 * CDNs answer 502/404, geo-block, or hang. Those failures used to disappear
 * into `console.warn`, which made "why is this channel black?" unanswerable in
 * production. This module keeps a bounded, in-memory record of recent proxy
 * outcomes so the admin dashboard can show what is actually failing.
 *
 * Deliberately kept in memory: it is operational telemetry, not an audit log.
 * It costs no latency on the playback path (`record*` is synchronous), needs no
 * database, and resets with the instance — which is the honest scope of the
 * data. Endpoints are stored as origin + path only, never the full URL, because
 * stream URLs routinely carry signed credentials.
 *
 * State lives on `globalThis` so it survives Next.js dev-mode module reloads.
 */

/** How many individual failures are retained for the dashboard table. */
const MAX_LOG_ENTRIES = 60;

/** Rolling window for the uptime/status counters. */
const WINDOW_MS = 15 * 60 * 1000;

/** Cap on retained samples inside the window (≈ 4/s sustained). */
const MAX_SAMPLES = 4_000;

/**
 * Failure kinds, so the dashboard can group causes rather than just statuses.
 */
export type ProxyErrorKind =
  /** Missing/invalid target URL or protocol. */
  | "invalid"
  /** Refused by the SSRF guard, or an attempt to proxy back into this app. */
  | "blocked"
  /** Upstream answered an error status (401/403/404/410/5xx). */
  | "upstream"
  /** Upstream answered 200 with something that was not an HLS manifest. */
  | "manifest"
  /** Above our size ceiling for playlists/segments. */
  | "limit"
  /** Timed out or threw inside the handler. */
  | "internal";

interface ProxySample {
  at: number;
  status: number;
  ok: boolean;
}

interface ProxyTelemetry {
  /** Every response we have seen inside the window, newest last. */
  samples: ProxySample[];
  /** Recent failures, newest first. */
  errors: AdminProxyError[];
  nextId: number;
}

function telemetry(): ProxyTelemetry {
  const g = globalThis as typeof globalThis & {
    __streamPulseProxyTelemetry?: ProxyTelemetry;
  };
  if (!g.__streamPulseProxyTelemetry) {
    g.__streamPulseProxyTelemetry = { samples: [], errors: [], nextId: 1 };
  }
  return g.__streamPulseProxyTelemetry;
}

function pushSample(status: number, ok: boolean) {
  const state = telemetry();
  state.samples.push({ at: Date.now(), status, ok });
  if (state.samples.length > MAX_SAMPLES) {
    state.samples.splice(0, state.samples.length - MAX_SAMPLES);
  }
}

/** Collapse a URL down to origin + path — query strings can carry credentials. */
function endpointOf(rawUrl: string | null): string {
  if (!rawUrl) return "(no url)";
  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname.length > 60 ? `${parsed.pathname.slice(0, 57)}…` : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return "(unparseable url)";
  }
}

/** Record a successful proxy response (manifest or segment). */
export function recordProxySuccess() {
  pushSample(200, true);
  recordRequest(true);
}

/** Record a failure and append it to the recent-error log. */
export function recordProxyError(status: number, kind: ProxyErrorKind, message: string, rawUrl?: string | null) {
  const state = telemetry();
  pushSample(status, false);
  recordRequest(false);

  state.errors.unshift({
    id: state.nextId++,
    at: Date.now(),
    status,
    kind,
    endpoint: endpointOf(rawUrl ?? null),
    message,
  });

  if (state.errors.length > MAX_LOG_ENTRIES) {
    state.errors.length = MAX_LOG_ENTRIES;
  }
}

/** Grouped counters for the dashboard's error-diagnostics panel. */
export function proxyErrorBreakdown(limit = 12): {
  key: string;
  label: string;
  status: number;
  count: number;
  lastAt: number;
  samples: { id: string; name: string }[];
}[] {
  const state = telemetry();
  const groups = new Map<
    string,
    { key: string; label: string; status: number; count: number; lastAt: number; samples: { id: string; name: string }[] }
  >();

  for (const entry of state.errors) {
    const key = String(entry.status);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: httpStatusLabel(entry.status),
        status: entry.status,
        count: 0,
        lastAt: 0,
        samples: [],
      };
      groups.set(key, group);
    }
    group.count++;
    if (entry.at > group.lastAt) group.lastAt = entry.at;
    if (group.samples.length < 5) {
      group.samples.push({ id: entry.endpoint, name: entry.message });
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.count - a.count).slice(0, limit);
}

/**
 * Snapshot for the dashboard: uptime over the window, a per-status breakdown,
 * and the most recent failures.
 */
export function proxyStatus(): AdminProxyStatus {
  const state = telemetry();
  const cutoff = Date.now() - WINDOW_MS;

  const inWindow = state.samples.filter((sample) => sample.at >= cutoff);
  // Drop expired samples so the buffer cannot be held by stale traffic.
  if (inWindow.length !== state.samples.length) state.samples = inWindow;

  const counts = new Map<number, number>();
  let failures = 0;
  for (const sample of inWindow) {
    counts.set(sample.status, (counts.get(sample.status) ?? 0) + 1);
    if (!sample.ok) failures++;
  }

  const total = inWindow.length;

  return {
    uptime: inWindow.length === 0 ? 1 : (inWindow.length - failures) / inWindow.length,
    total,
    failures,
    windowMs: WINDOW_MS,
    byStatus: Array.from(counts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    recent: state.errors.filter((entry) => entry.at >= cutoff).slice(0, MAX_LOG_ENTRIES),
  };
}

/** Drop all telemetry — used by the dashboard's force-scan reset. */
export function clearProxyLog() {
  const state = telemetry();
  state.errors = [];
}
