/**
 * Shared shapes for the admin console.
 *
 * Defined in one place so `/api/admin/*` and the `/admin` client agree on the
 * contract without either importing the other's module graph.
 */

import type { UserRole } from "@/lib/user-role";

/* -------------------------------------------------------------------------- */
/* Channels                                                                    */
/* -------------------------------------------------------------------------- */

export interface AdminChannelBreakdown {
  /** Channels in the active catalogue. */
  total: number;
  /** Probed within the TTL and confirmed to answer. */
  live: number;
  /** Probed within the TTL and confirmed dead (404/410/502/…). */
  offline: number;
  /** Never probed, or probed longer ago than the health TTL. */
  unknown: number;
  /** Distinct categories and countries present in the catalogue. */
  categories: number;
  countries: number;
  /** Where the catalogue came from: upstream, memory/disk cache, or bootstrap. */
  source: "live" | "cache" | "fallback";
  /** Epoch ms of the last successful upstream fetch (0 for the bootstrap set). */
  fetchedAt: number;
}

/* -------------------------------------------------------------------------- */
/* Viewers                                                                     */
/* -------------------------------------------------------------------------- */

export interface AdminChannelViewers {
  id: string;
  name: string;
  category: string;
  country: string;
  viewers: number;
}

export interface AdminViewers {
  /** Distinct sessions seen inside the presence window. */
  active: number;
  /** High-water mark since this instance booted. */
  peak: number;
  /** Sessions ever tracked by this process. */
  sessions: number;
  windowMs: number;
  top: AdminChannelViewers[];
}

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

export interface AdminUsers {
  total: number | null;
  /** Accounts that signed in within the last 24 hours. */
  activeToday: number;
  /** Accounts that signed in within the last 7 days. */
  activeWeek: number;
  available: boolean;
  reason?: string;
  last7Days: { date: string; count: number }[];
  /** True when the sign-up histogram is a page sample rather than a full count. */
  approximate: boolean;
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  name: string;
  createdAt: number;
  lastSignInAt: number;
  /** Role from `public.profiles`: `admin` opens the console, `user` does not. */
  role: UserRole;
  /** True when the account is currently banned in Supabase. */
  suspended: boolean;
  /** ISO timestamp the ban lifts, when known. */
  bannedUntil: string | null;
  emailConfirmed: boolean;
  provider: string;
}

export interface AdminUsersPage {
  users: AdminUserRow[];
  total: number;
  page: number;
  perPage: number;
  available: boolean;
  reason?: string;
}

/* -------------------------------------------------------------------------- */
/* Proxy                                                                       */
/* -------------------------------------------------------------------------- */

export interface AdminProxyError {
  id: number;
  at: number;
  status: number;
  /** `invalid` | `blocked` | `upstream` | `manifest` | `limit` | `internal` */
  kind: string;
  /** Origin + path only — never the full (possibly signed) stream URL. */
  endpoint: string;
  message: string;
}

export interface AdminProxyStatus {
  /** Success share over the rolling window, 0–1. */
  uptime: number;
  total: number;
  failures: number;
  windowMs: number;
  byStatus: { status: number; count: number }[];
  recent: AdminProxyError[];
}

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

export interface AdminHealth {
  live: number;
  dead: number;
  tracked: number;
  watching: number;
  /** Epoch ms of the last completed sweep (0 when none has run). */
  lastSweepAt: number;
  ttlMs: number;
  /** False when the dead ratio was implausible and the verdicts were ignored. */
  trusted: boolean;
}

export interface AdminStreamRow {
  id: string;
  name: string;
  category: string;
  country: string;
  url: string;
  /** `live` = Online, `dead` = Offline, `unknown` = never probed / stale verdict. */
  status: "live" | "dead" | "unknown";
  checkedAt: number;
  latencyMs: number;
  httpStatus: number;
  error?: string;
}

export interface AdminStreamsResponse {
  rows: AdminStreamRow[];
  total: number;
  counts: { online: number; offline: number; unknown: number };
  page: number;
  perPage: number;
}

/** A failing-stream bucket, merged across probe verdicts and proxy failures. */
export interface AdminErrorGroup {
  key: string;
  label: string;
  status: number;
  count: number;
  lastAt: number;
  /** Where the failures were observed. */
  source: "probe" | "proxy" | "both";
  samples: { id: string; name: string }[];
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

export interface AdminActivityPoint {
  /** Bucket start, epoch ms. */
  at: number;
  requests: number;
  failures: number;
  views: number;
}

export interface AdminMetrics {
  series: AdminActivityPoint[];
  requestsTotal: number;
  failuresTotal: number;
  successRate: number;
  health: {
    checksTotal: number;
    checksAutomated: number;
    checksManual: number;
    liveVerdicts: number;
    deadVerdicts: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    liveRatio: number;
  };
  startedAt: number;
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                       */
/* -------------------------------------------------------------------------- */

export interface AdminCacheStats {
  catalogue: {
    loaded: boolean;
    channels: number;
    fetchedAt: number;
    ageMs: number;
    stale: boolean;
    refreshing: boolean;
    ttlMs: number;
  };
  segments: {
    entries: number;
    capacity: number;
    bytes: number;
    hits: number;
    misses: number;
    hitRate: number;
    ttlMs: number;
  };
  health: {
    tracked: number;
    watching: number;
    ttlMs: number;
  };
  /** Number of viewer sessions the presence registry is holding. */
  presenceSessions: number;
}

/* -------------------------------------------------------------------------- */
/* Announcements                                                               */
/* -------------------------------------------------------------------------- */

export type AdminAnnouncementLevel = "info" | "success" | "warning" | "critical";

export interface AdminAnnouncement {
  id: string;
  message: string;
  level: AdminAnnouncementLevel;
  detail?: string;
  href?: string;
  publishedAt: number;
  expiresAt: number;
  publishedBy: string;
}

/* -------------------------------------------------------------------------- */
/* Aggregate                                                                   */
/* -------------------------------------------------------------------------- */

export interface AdminTopChannel {
  id: string;
  name: string;
  category: string;
  country: string;
  /** Concurrent viewers in the presence window. */
  viewers: number;
  /** Times saved to a member's favorites. */
  favorites: number;
  score: number;
}

export interface AdminCountryRow {
  code: string;
  name: string;
  count: number;
}

export interface AdminStats {
  generatedAt: string;
  channels: AdminChannelBreakdown;
  viewers: AdminViewers;
  users: AdminUsers;
  proxy: AdminProxyStatus;
  health: AdminHealth;
  metrics: AdminMetrics;
  cache: AdminCacheStats;
  announcement: AdminAnnouncement | null;
  /** Probe verdict counts for the whole catalogue (paging-independent). */
  streams: { online: number; offline: number; unknown: number };
  errors: AdminErrorGroup[];
  topChannels: AdminTopChannel[];
  categories: { name: string; count: number }[];
  countries: AdminCountryRow[];
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export type AdminAction =
  | "health-check"
  | "deep-health-check"
  | "refresh-cache"
  | "clear-caches"
  | "flush-states";

export interface AdminScanResult {
  checked: number;
  dead: number;
  durationMs: number;
  finishedAt: string;
  /** True when the probe budget ran out before every target was checked. */
  timedOut: boolean;
}

export interface AdminActionResult {
  ok: boolean;
  action: AdminAction;
  /** One-line, human-readable outcome shown next to the button. */
  summary: string;
  /** Action-specific detail (counts, byte sizes, durations…). */
  detail: Record<string, unknown>;
  stats: AdminStats;
}

/** Alias so route handlers can name the response without repeating the shape. */
export type AdminActionResponse = AdminActionResult;

export interface AdminStreamsQuery {
  status?: "all" | "online" | "offline" | "unknown";
  search?: string;
  page?: number;
  perPage?: number;
}
