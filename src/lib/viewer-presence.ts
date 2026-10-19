import type { AdminChannelViewers } from "@/types/admin";
import { recordStreamView } from "@/lib/metrics";

/**
 * Live viewer presence.
 *
 * "Active Live Viewers" has to come from somewhere, and the app has no
 * external analytics: watch history is browser-local and Supabase only stores
 * favorites. So the player sends a small heartbeat while it is mounted, and
 * this module keeps a bounded in-memory record of who is watching what.
 *
 * Two counters are derived, and they measure different things on purpose:
 *
 *   - **viewers** — distinct sessions that beat inside the presence window.
 *     This is concurrency: it decays when a tab is closed.
 *   - **watches** — sessions that *started* watching a channel (a new viewer, or
 *     an existing one switching channel). Counting per heartbeat instead would
 *     inflate the number by the poll rate and make the ranking meaningless.
 *
 * Scope, stated plainly: presence is per server instance and resets when that
 * instance is recycled, so on serverless hosting this is a strong lower bound on
 * real concurrency rather than an exact global figure. The dashboard labels it
 * accordingly. Storing it durably would mean a database table; this needs none.
 *
 * State lives on `globalThis` so it survives Next.js dev-mode module reloads.
 */

/** A session is "active" while it keeps beating inside this window. */
export const PRESENCE_WINDOW_MS = 90_000;

/** How long per-channel watch statistics are retained for the leaderboard. */
const CHANNEL_RETENTION_MS = 6 * 60 * 60 * 1000;

/** Hard ceiling on tracked sessions so the endpoint cannot be memory-abused. */
const MAX_SESSIONS = 20_000;

/** How long a validated session id is trusted before re-checking with Supabase. */
const VERIFY_TTL_MS = 5 * 60 * 1000;

export interface ChannelRef {
  id: string;
  name: string;
  category: string;
  country: string;
}

interface ViewerSession {
  lastSeen: number;
  /** Epoch ms until which this session id has already been authenticated. */
  verifiedUntil: number;
  /** Channel currently being watched, so watch counts only move on a switch. */
  channelId: string | null;
}

interface ChannelWatch {
  ref: ChannelRef;
  /** Sessions currently watching (ids are pruned against the session table). */
  viewers: Set<string>;
  /** Sessions that started watching this channel. */
  watches: number;
  lastSeen: number;
}

interface PresenceRegistry {
  sessions: Map<string, ViewerSession>;
  channels: Map<string, ChannelWatch>;
  peak: number;
  /** Sessions ever seen by this process (monotonic). */
  totalSessions: number;
}

function presence(): PresenceRegistry {
  const g = globalThis as typeof globalThis & {
    __streamPulsePresence?: PresenceRegistry;
  };
  if (!g.__streamPulsePresence) {
    g.__streamPulsePresence = {
      sessions: new Map(),
      channels: new Map(),
      peak: 0,
      totalSessions: 0,
    };
  }
  return g.__streamPulsePresence;
}

/** Drop sessions past the window, detach them from their channel, and age out
 *  per-channel statistics that have not been touched for a long time. */
function prune(reg: PresenceRegistry) {
  const now = Date.now();

  for (const [id, session] of reg.sessions) {
    if (now - session.lastSeen > PRESENCE_WINDOW_MS) {
      reg.sessions.delete(id);
      if (session.channelId) reg.channels.get(session.channelId)?.viewers.delete(id);
    }
  }

  for (const [id, watch] of reg.channels) {
    if (now - watch.lastSeen > CHANNEL_RETENTION_MS) reg.channels.delete(id);
  }
}

/**
 * True when this session id was validated with Supabase recently enough that
 * the heartbeat can skip another round trip to the Auth server.
 */
export function isSessionVerified(sessionId: string): boolean {
  const entry = presence().sessions.get(sessionId);
  return Boolean(entry && entry.verifiedUntil > Date.now());
}

/** Remember that a session id belongs to an authenticated user. */
export function markSessionVerified(sessionId: string) {
  const reg = presence();
  const entry = reg.sessions.get(sessionId);
  if (entry) entry.verifiedUntil = Date.now() + VERIFY_TTL_MS;
}

/** Record one heartbeat (or a channel switch) for a session. */
export function heartbeat(sessionId: string, channel: ChannelRef | null) {
  const reg = presence();
  const now = Date.now();

  let session = reg.sessions.get(sessionId);
  if (!session) {
    // Bound the table: drop sessions past the window first, then the oldest.
    prune(reg);
    if (reg.sessions.size >= MAX_SESSIONS) {
      const oldest = reg.sessions.keys().next().value;
      if (oldest) reg.sessions.delete(oldest);
    }
    session = { lastSeen: now, verifiedUntil: 0, channelId: null };
    reg.sessions.set(sessionId, session);
    reg.totalSessions++;
  }

  session.lastSeen = now;

  if (!channel) return;

  const channelId = channel.id;
  let watch = reg.channels.get(channelId);
  if (!watch) {
    watch = { ref: channel, viewers: new Set(), watches: 0, lastSeen: now };
    reg.channels.set(channelId, watch);
  }
  watch.ref = channel;
  watch.lastSeen = now;

  // A new viewer, or an existing one switching channel, counts as one watch.
  // Repeat heartbeats on the same channel do not — that would inflate the
  // number by the poll rate and make the leaderboard meaningless.
  if (session.channelId !== channelId) {
    watch.watches++;
    session.channelId = channelId;
    recordStreamView();
  }

  watch.viewers.add(sessionId);
}

/** Detach a session (page unload) so concurrency drops immediately. */
export function dropSession(sessionId: string) {
  const reg = presence();
  const session = reg.sessions.get(sessionId);
  if (session?.channelId) {
    reg.channels.get(session.channelId)?.viewers.delete(sessionId);
  }
  reg.sessions.delete(sessionId);
}

export interface PresenceSnapshot {
  active: number;
  peak: number;
  sessions: number;
  windowMs: number;
  top: AdminChannelViewers[];
  /** Every channel with live viewers or recorded watches, for analytics. */
  byChannel: { ref: ChannelRef; viewers: number; watches: number }[];
  /** Total watches recorded across all channels in the process lifetime. */
  totalWatches: number;
}

/** Point-in-time presence snapshot, with stale entries pruned. */
export function presenceSnapshot(): PresenceSnapshot {
  const reg = presence();
  prune(reg);

  const perChannel: { ref: ChannelRef; viewers: number; watches: number }[] = [];
  let totalWatches = 0;

  for (const watch of reg.channels.values()) {
    // Re-check membership: a session may have expired since it was attached.
    let live = 0;
    for (const sessionId of watch.viewers) {
      const session = reg.sessions.get(sessionId);
      if (!session) {
        watch.viewers.delete(sessionId);
        continue;
      }
      if (session.channelId === watch.ref.id) live++;
      else watch.viewers.delete(sessionId);
    }

    totalWatches += watch.watches;
    perChannel.push({ ref: watch.ref, viewers: live, watches: watch.watches });
  }

  const active = reg.sessions.size;
  if (active > reg.peak) reg.peak = active;

  perChannel.sort((a, b) => b.viewers - a.viewers || b.watches - a.watches);

  return {
    active,
    peak: reg.peak,
    sessions: reg.totalSessions,
    windowMs: PRESENCE_WINDOW_MS,
    top: perChannel
      .filter((entry) => entry.viewers > 0)
      .slice(0, 8)
      .map((entry) => ({
        id: entry.ref.id,
        name: entry.ref.name,
        category: entry.ref.category,
        country: entry.ref.country,
        viewers: entry.viewers,
      })),
    byChannel: perChannel,
    totalWatches,
  };
}

/** Channel retention for the leaderboard (exposed for the dashboard copy). */
export const CHANNEL_STATS_RETENTION_MS = CHANNEL_RETENTION_MS;
