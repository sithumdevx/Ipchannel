import type { Channel } from "@/types/iptv";
import type {
  AdminCacheStats,
  AdminCountryRow,
  AdminErrorGroup,
  AdminStats,
  AdminTopChannel,
} from "@/types/admin";

import { catalogStats, getChannelCatalog } from "@/lib/channels";
import { resolveCountry } from "@/lib/countries";
import { getAnnouncement } from "@/lib/announcements";
import { loadFavoriteCounts, loadUserStats, serviceClient } from "@/lib/admin-supabase";
import { metricsSnapshot } from "@/lib/metrics";
import { proxyErrorBreakdown, proxyStatus } from "@/lib/proxy-log";
import { segmentCacheStats } from "@/lib/segment-cache";
import {
  categorizeHealth,
  ensureHealthSweeper,
  healthCounts,
  healthErrorBreakdown,
  healthSummary,
} from "@/lib/stream-health";
import { presenceSnapshot } from "@/lib/viewer-presence";

/**
 * Admin analytics aggregator.
 *
 * One function, one shape, one place: both `/api/admin/stats` and
 * `/api/admin/actions` return exactly this payload, so the console never has to
 * reconcile two slightly different versions of "the numbers".
 *
 * Sources, and why each is where it is:
 *   - the channel catalogue    → volume, live/offline split, distributions
 *   - the health registry      → probe verdicts, latency, failure reasons
 *   - the proxy telemetry ring → viewer-facing 502/404s and uptime
 *   - the metrics ring         → the 24-hour activity series and check totals
 *   - the presence registry    → concurrent viewers and most-watched channels
 *   - Supabase (service role)  → registered users and favorites, when configured
 *
 * Every source is in-process or a bounded query, so this stays a cheap call.
 */

/** Upper bounds on returned distributions, to keep the payload small. */
const MAX_CATEGORY_ROWS = 24;
const MAX_COUNTRY_ROWS = 24;
const MAX_TOP_CHANNELS = 12;

/* -------------------------------------------------------------------------- */
/* Distributions                                                               */
/* -------------------------------------------------------------------------- */

function buildDistributions(channels: Channel[]): {
  categories: { name: string; count: number }[];
  countries: AdminCountryRow[];
} {
  const categoryCounts = new Map<string, number>();
  const countryCounts = new Map<string, { name: string; count: number }>();

  for (const channel of channels) {
    const category = channel.category?.trim();
    if (category) categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    const resolved = resolveCountry(channel.country);
    if (!resolved) continue;

    const entry = countryCounts.get(resolved.code);
    if (entry) entry.count++;
    else countryCounts.set(resolved.code, { name: resolved.name, count: 1 });
  }

  return {
    categories: Array.from(categoryCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_CATEGORY_ROWS),
    countries: Array.from(countryCounts.entries())
      .map(([code, entry]) => ({ code, name: entry.name, count: entry.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_COUNTRY_ROWS),
  };
}

/* -------------------------------------------------------------------------- */
/* Failure buckets                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Merge probe-side and proxy-side failure buckets.
 *
 * They answer different halves of one question — a probe says "the origin will
 * not answer a health check", a proxy failure says "the origin would not serve a
 * viewer just now" — so a status present in both is strictly more concerning and
 * is labelled as such.
 */
function mergeErrorGroups(
  probe: ReturnType<typeof healthErrorBreakdown>,
  proxy: ReturnType<typeof proxyErrorBreakdown>
): AdminErrorGroup[] {
  const merged = new Map<string, AdminErrorGroup>();

  for (const group of probe) {
    merged.set(group.key, { ...group, source: "probe" });
  }

  for (const group of proxy) {
    const existing = merged.get(group.key);

    if (existing) {
      existing.count += group.count;
      existing.lastAt = Math.max(existing.lastAt, group.lastAt);
      existing.samples = [...existing.samples, ...group.samples].slice(0, 5);
      existing.source = "both";
      continue;
    }

    merged.set(group.key, {
      key: group.key,
      label: group.label,
      status: group.status,
      count: group.count,
      lastAt: group.lastAt,
      source: "proxy",
      samples: group.samples.slice(0, 5),
    });
  }

  return Array.from(merged.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

/* -------------------------------------------------------------------------- */
/* Leaderboard                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Rank channels by what people actually watch.
 *
 * Two signals are merged because neither suffices alone: live concurrency
 * (immediate, but resets with the process) and member favorites (persistent, but
 * reflects intent rather than viewing). Concurrency is weighted higher because
 * the console's question is "what is hot right now".
 */
function buildTopChannels(
  channels: Channel[],
  presenceById: Map<string, { name: string; category: string; country: string; viewers: number }>,
  favorites: Map<string, number>
): AdminTopChannel[] {
  const catalogueById = new Map(channels.map((channel) => [channel.id, channel]));
  const ids = new Set<string>([...presenceById.keys(), ...favorites.keys()]);
  const rows: AdminTopChannel[] = [];

  for (const id of ids) {
    const channel = catalogueById.get(id);
    const presence = presenceById.get(id);
    const favoritesCount = favorites.get(id) ?? 0;

    if (!channel && !presence) continue;

    rows.push({
      id,
      name: channel?.name ?? presence?.name ?? id,
      category: channel?.category ?? presence?.category ?? "",
      country: channel?.country ?? presence?.country ?? "",
      viewers: presence?.viewers ?? 0,
      favorites: favoritesCount,
      score: (presence?.viewers ?? 0) * 3 + favoritesCount * 2,
    });
  }

  return rows.sort((a, b) => b.score - a.score).slice(0, MAX_TOP_CHANNELS);
}

/* -------------------------------------------------------------------------- */
/* Cache + presence summary                                                    */
/* -------------------------------------------------------------------------- */

function buildCacheStats(
  catalog: ReturnType<typeof catalogStats>,
  sessions: number
): AdminCacheStats {
  const segments = segmentCacheStats();
  const health = healthSummary();

  return {
    catalogue: catalog,
    segments,
    health: {
      tracked: health.tracked,
      watching: health.watching,
      ttlMs: health.ttlMs,
    },
    presenceSessions: sessions,
  };
}

/* -------------------------------------------------------------------------- */
/* Aggregate                                                                   */
/* -------------------------------------------------------------------------- */

export async function collectAdminStats(): Promise<AdminStats> {
  ensureHealthSweeper();

  const catalog = await getChannelCatalog();
  const channels = catalog.channels;

  const breakdown = categorizeHealth(channels);
  const distributions = buildDistributions(channels);
  const presence = presenceSnapshot();
  const proxy = proxyStatus();
  const metrics = metricsSnapshot();
  const counts = healthCounts(channels);

  const presenceById = new Map(
    presence.byChannel.map((entry) => [
      entry.ref.id,
      {
        name: entry.ref.name,
        category: entry.ref.category,
        country: entry.ref.country,
        viewers: entry.viewers,
      },
    ])
  );

  const { client, reason } = serviceClient();
  const [users, favorites, announcement] = await Promise.all([
    loadUserStats(client),
    loadFavoriteCounts(client),
    getAnnouncement(),
  ]);

  // Surface *why* the directory is empty rather than showing a bare zero.
  const usersOut = users.available || users.reason ? users : { ...users, reason };

  return {
    generatedAt: new Date().toISOString(),
    channels: {
      total: channels.length,
      live: breakdown.live,
      offline: breakdown.dead,
      unknown: breakdown.unknown,
      categories: distributions.categories.length,
      countries: distributions.countries.length,
      source: catalog.source,
      fetchedAt: catalog.fetchedAt,
    },
    viewers: {
      active: presence.active,
      peak: presence.peak,
      sessions: presence.sessions,
      windowMs: presence.windowMs,
      top: presence.top,
    },
    users: usersOut,
    proxy,
    health: {
      ...healthSummary(),
      trusted: breakdown.trusted,
    },
    metrics,
    cache: buildCacheStats(catalogStats(), presence.active),
    announcement,
    topChannels: buildTopChannels(channels, presenceById, favorites),
    categories: distributions.categories,
    countries: distributions.countries,
    errors: mergeErrorGroups(healthErrorBreakdown(channels), proxyErrorBreakdown()),
    streams: counts,
  } as unknown as AdminStats;
}
