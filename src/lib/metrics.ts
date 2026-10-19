/**
 * Process-wide operational metrics.
 *
 * The admin console needs three things the rest of the app does not track:
 * a 24-hour activity series, a count of health checks performed, and a
 * breakdown of *why* streams failed. All three are derived by observing events
 * that already happen (a proxy response, a finished probe, a watch starting)
 * rather than by adding a database or an analytics SDK.
 *
 * Scope, stated plainly: this is a bounded, in-memory ring of counters. It
 * resets with the server instance, so on serverless hosting the series shows the
 * life of the current instance. That is the honest scope of data that costs
 * nothing on the request path and needs no schema — the dashboard labels it.
 *
 * Everything here is synchronous and cheap: counters and fixed-size buffers,
 * never an unbounded array, and never a network call.
 *
 * State lives on `globalThis` so it survives Next.js dev-mode module reloads.
 */

/** Bucket width for the activity series. */
const HOUR_MS = 60 * 60 * 1000;

/** How many hours of history the series keeps and returns. */
export const SERIES_HOURS = 24;

/** Rolling latency samples kept for percentile estimates. */
const MAX_LATENCY_SAMPLES = 600;

/** Cap on distinct error-type buckets (status codes are few, but be safe). */
const MAX_ERROR_TYPES = 40;

interface HourBucket {
  requests: number;
  failures: number;
  /** Stream views started in this hour. */
  views: number;
}

export interface MetricsState {
  /** hourStart (epoch ms) → counters. */
  buckets: Map<number, HourBucket>;
  /** Probes completed since boot, split by trigger. */
  checksTotal: number;
  checksManual: number;
  /** Probe verdicts since boot. */
  liveVerdicts: number;
  deadVerdicts: number;
  /** Rolling probe durations (ms) for percentile estimates. */
  latencySamples: number[];
  /** Failing-stream breakdown, keyed by a stable error key. */
  errors: Map<string, { label: string; status: number; count: number; lastAt: number; sample: string }>;
  /** Requests served since boot (not just the 24-hour window). */
  requestsTotal: number;
  failuresTotal: number;
  startedAt: number;
}

function metricsState(): MetricsState {
  const g = globalThis as typeof globalThis & { __streamPulseMetrics?: MetricsState };
  if (!g.__streamPulseMetrics) {
    g.__streamPulseMetrics = {
      buckets: new Map(),
      checksTotal: 0,
      checksManual: 0,
      liveVerdicts: 0,
      deadVerdicts: 0,
      latencySamples: [],
      errors: new Map(),
      requestsTotal: 0,
      failuresTotal: 0,
      startedAt: Date.now(),
    };
  }
  return g.__streamPulseMetrics;
}

function hourStart(at: number): number {
  return Math.floor(at / HOUR_MS) * HOUR_MS;
}

function bucketFor(state: MetricsState, at: number): HourBucket {
  const key = hourStart(at);
  let bucket = state.buckets.get(key);
  if (!bucket) {
    bucket = { requests: 0, failures: 0, views: 0 };
    state.buckets.set(key, bucket);
    // Drop anything older than the window so the map cannot grow forever.
    if (state.buckets.size > SERIES_HOURS * 2) {
      const cutoff = hourStart(Date.now()) - SERIES_HOURS * HOUR_MS;
      for (const key of state.buckets.keys()) {
        if (key < cutoff) state.buckets.delete(key);
      }
    }
  }
  return bucket;
}

/* -------------------------------------------------------------------------- */
/* Recording                                                                   */
/* -------------------------------------------------------------------------- */

/** One HTTP response from the stream proxy (or any measured API surface). */
export function recordRequest(ok: boolean) {
  const state = metricsState();
  const bucket = bucketFor(state, Date.now());
  bucket.requests++;
  state.requestsTotal++;
  if (!ok) {
    bucket.failures++;
    state.failuresTotal++;
  }
}

/** A viewer started watching a channel — one "active stream view". */
export function recordStreamView() {
  bucketFor(metricsState(), Date.now()).views++;
}

/**
 * A stream probe finished.
 *
 * `manual` distinguishes an admin-triggered scan from the automated sweep, so
 * the dashboard can report "automated health checks" honestly rather than
 * counting the operator's own clicks as automation.
 */
export function recordHealthCheck(
  outcome: { status: "live" | "dead"; latencyMs: number; httpStatus: number; error?: string },
  options: { manual?: boolean } = {}
) {
  const state = metricsState();

  state.checksTotal++;
  if (options.manual) state.checksManual++;

  if (outcome.status === "live") {
    state.liveVerdicts++;
  } else {
    state.deadVerdicts++;
    recordErrorType(state, outcome.httpStatus, outcome.error, "");
  }

  if (Number.isFinite(outcome.latencyMs) && outcome.latencyMs >= 0) {
    state.latencySamples.push(outcome.latencyMs);
    if (state.latencySamples.length > MAX_LATENCY_SAMPLES) {
      state.latencySamples.splice(0, state.latencySamples.length - MAX_LATENCY_SAMPLES);
    }
  }
}

function recordErrorType(
  state: MetricsState,
  status: number,
  error: string | undefined,
  sample: string
) {
  const key = status > 0 ? String(status) : "network";
  const existing = state.errors.get(key);

  if (existing) {
    existing.count++;
    existing.lastAt = Date.now();
    return;
  }

  if (state.errors.size >= MAX_ERROR_TYPES) return;

  state.errors.set(key, {
    label: status > 0 ? httpStatusLabel(status) : "No response (timeout / DNS / TLS)",
    status,
    count: 1,
    lastAt: Date.now(),
    sample: sample || error || "",
  });
}

/** Canonical reason phrase for the statuses that actually show up. */
export function httpStatusLabel(status: number): string {
  switch (status) {
    case 400:
      return "400 Bad Request";
    case 401:
      return "401 Unauthorized";
    case 403:
      return "403 Forbidden";
    case 404:
      return "404 Not Found";
    case 408:
      return "408 Request Timeout";
    case 410:
      return "410 Gone";
    case 413:
      return "413 Payload Too Large";
    case 429:
      return "429 Too Many Requests";
    case 500:
      return "500 Internal Server Error";
    case 502:
      return "502 Bad Gateway";
    case 503:
      return "503 Service Unavailable";
    case 504:
      return "504 Gateway Timeout";
    default:
      return status >= 500 ? `${status} Server Error` : `${status} Client Error`;
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export interface ActivityPoint {
  /** Bucket start, epoch ms. */
  at: number;
  requests: number;
  failures: number;
  views: number;
}

export interface MetricsSnapshot {
  series: ActivityPoint[];
  /** Requests served since boot. */
  requestsTotal: number;
  failuresTotal: number;
  /** Uptime over the retained series, 0–1 (1 when there is no traffic yet). */
  successRate: number;
  health: {
    checksTotal: number;
    checksAutomated: number;
    checksManual: number;
    liveVerdicts: number;
    deadVerdicts: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    /** Share of judged streams that answered, 0–1. */
    liveRatio: number;
  };
  errors: { key: string; label: string; status: number; count: number; lastAt: number; sample: string }[];
  startedAt: number;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return Math.round(sum / values.length);
}

/** Snapshot for the dashboard: the 24-hour series plus lifetime counters. */
export function metricsSnapshot(): MetricsSnapshot {
  const state = metricsState();

  // Oldest first, so the chart reads left-to-right as time moves forward, and
  // every bucket in the window is present so gaps render as zero rather than
  // silently collapsing the axis.
  const series: ActivityPoint[] = [];
  const windowStart = hourStart(Date.now()) - (SERIES_HOURS - 1) * HOUR_MS;

  for (let i = 0; i < SERIES_HOURS; i++) {
    const at = windowStart + i * HOUR_MS;
    const bucket = state.buckets.get(at);
    series.push({
      at,
      requests: bucket?.requests ?? 0,
      failures: bucket?.failures ?? 0,
      views: bucket?.views ?? 0,
    });
  }

  let requestsCount = 0;
  let failuresCount = 0;
  for (const point of series) {
    requestsCount += point.requests;
    failuresCount += point.failures;
  }

  const sorted = [...state.latencySamples].sort((a, b) => a - b);
  const judged = state.liveVerdicts + state.deadVerdicts;

  return {
    series,
    requestsTotal: state.requestsTotal,
    failuresTotal: state.failuresTotal,
    successRate: requestsCount === 0 ? 1 : (requestsCount - failuresCount) / requestsCount,
    health: {
      checksTotal: state.checksTotal,
      checksAutomated: Math.max(0, state.checksTotal - state.checksManual),
      checksManual: state.checksManual,
      liveVerdicts: state.liveVerdicts,
      deadVerdicts: state.deadVerdicts,
      avgLatencyMs: average(state.latencySamples),
      p95LatencyMs: percentile(sorted, 0.95),
      liveRatio: judged === 0 ? 1 : state.liveVerdicts / judged,
    },
    errors: Array.from(state.errors.entries())
      .map(([key, entry]) => ({ key, ...entry }))
      .sort((a, b) => b.count - a.count),
    startedAt: state.startedAt,
  };
}

/** Wipe counters — the dashboard's "flush stale state" action. */
export function resetMetrics() {
  const state = metricsState();
  state.buckets.clear();
  state.checksTotal = 0;
  state.checksManual = 0;
  state.liveVerdicts = 0;
  state.deadVerdicts = 0;
  state.latencySamples.length = 0;
  state.errors.clear();
  state.requestsTotal = 0;
  state.failuresTotal = 0;
  state.startedAt = Date.now();
}
