import { readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Site-wide broadcast announcements.
 *
 * One announcement is live at a time: an operator publishes a banner, every
 * connected client picks it up on its next poll, and clearing it removes the
 * banner everywhere. Keeping it to a single slot is deliberate — a stack of
 * banners is how a site becomes unreadable, and "maintenance notice" is the
 * actual use case.
 *
 * Storage is process memory plus a disk snapshot, mirroring the channel
 * catalogue. That is enough for a long-lived server (a VM, Docker, `next start`
 * on a single instance) where the snapshot survives a restart.
 *
 * Honest limitation: on serverless hosting each instance has an isolated memory
 * space *and* an isolated `/tmp`, so a publish reaches a client as soon as that
 * client's next poll lands on an instance that has seen the write. For a hard
 * global guarantee across many instances, move `readStore`/`writeStore` onto a
 * shared row (a Supabase table) — the interface below would not change. The
 * admin UI states this rather than implying a guarantee the deployment cannot
 * make.
 *
 * Every filesystem interaction is guarded: a read-only or missing volume must
 * never break the admin console or the public banner endpoint.
 */

export type AnnouncementLevel = "info" | "success" | "warning" | "critical";

export interface Announcement {
  id: string;
  message: string;
  level: AnnouncementLevel;
  /** Optional longer text, revealed when the viewer expands the banner. */
  detail?: string;
  /** Optional call-to-action link. */
  href?: string;
  /** Epoch ms of publication. */
  publishedAt: number;
  /** Epoch ms after which the banner auto-expires. 0 means "never". */
  expiresAt: number;
  /** Email of the administrator who published it. */
  publishedBy: string;
}

const PERSIST_FILE = join(tmpdir(), "streampulse-announcement.json");
const PERSIST_VERSION = 1;

/** Hard caps so a published banner can never blow up the payload. */
export const ANNOUNCEMENT_LIMITS = {
  message: 280,
  detail: 500,
  href: 512,
  /** Longest allowed auto-expiry, in minutes (30 days). */
  expiryMinutes: 43_200,
} as const;

const LEVELS: AnnouncementLevel[] = ["info", "success", "warning", "critical"];

interface AnnouncementState {
  current: Announcement | null;
  hydrated: boolean;
}

function announcementState(): AnnouncementState {
  const g = globalThis as typeof globalThis & { __streamPulseAnnouncement?: AnnouncementState };
  if (!g.__streamPulseAnnouncement) {
    g.__streamPulseAnnouncement = { current: null, hydrated: false };
  }
  return g.__streamPulseAnnouncement;
}

/** True when a published announcement should still be shown. */
export function isAnnouncementLive(announcement: Announcement | null, at = Date.now()): boolean {
  if (!announcement) return false;
  if (!announcement.message) return false;
  if (announcement.expiresAt === 0) return true;
  return announcement.expiresAt > at;
}

/** Throwaway origin used to ask the URL parser where a candidate link goes. */
const SITE_PROBE_ORIGIN = "https://announcement.invalid";

/**
 * Would a browser treat `candidate` as a path on our own site?
 *
 * A prefix test alone is not enough. Browsers normalise backslashes and strip
 * control characters, so `/\evil.com` is parsed as `//evil.com` — a
 * protocol-relative URL that hands the visitor to another host. Resolving
 * against a throwaway origin is the only check that agrees with the browser,
 * and it also rejects `javascript:` / `data:` URLs (their origin is `"null"`).
 */
function isSameOriginPath(candidate: string): boolean {
  if (!candidate.startsWith("/")) return false;
  // Backslashes and control characters are what make the string-vs-parser
  // disagreement exploitable, so refuse them outright as well.
  if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return false;
  try {
    return new URL(candidate, SITE_PROBE_ORIGIN).origin === SITE_PROBE_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Normalise + validate operator input. Throws with a readable reason.
 *
 * `href` accepts a site-relative path or an absolute `http(s)` URL. The
 * relative case is verified by *parsing* rather than by prefix matching,
 * because the two disagree about inputs like `/\evil.com` — see above.
 */
export function normalizeAnnouncementInput(input: {
  message?: unknown;
  level?: unknown;
  detail?: unknown;
  href?: unknown;
  expiresInMinutes?: unknown;
}): { message: string; level: AnnouncementLevel; detail?: string; href?: string; expiresInMinutes: number } {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) throw new Error("A message is required.");
  if (message.length > ANNOUNCEMENT_LIMITS.message) {
    throw new Error(`Message must be ${ANNOUNCEMENT_LIMITS.message} characters or fewer.`);
  }

  const level = LEVELS.includes(input.level as AnnouncementLevel)
    ? (input.level as AnnouncementLevel)
    : "info";

  const detail =
    typeof input.detail === "string" && input.detail.trim()
      ? input.detail.trim().slice(0, ANNOUNCEMENT_LIMITS.detail)
      : undefined;

  let href: string | undefined;
  if (typeof input.href === "string" && input.href.trim()) {
    const candidate = input.href.trim();
    // Only same-site paths and absolute http(s) URLs: an operator — or anyone
    // holding a hijacked admin session — must not be able to turn the banner
    // into an open redirect.
    if (/^https?:\/\//i.test(candidate)) {
      href = candidate.slice(0, ANNOUNCEMENT_LIMITS.href);
    } else if (isSameOriginPath(candidate)) {
      href = candidate.slice(0, ANNOUNCEMENT_LIMITS.href);
    } else {
      throw new Error(
        "Link must be a same-site path beginning with / (e.g. /about), or an absolute http(s) URL."
      );
    }
  }

  const rawMinutes = Number(input.expiresInMinutes);
  const expiresInMinutes =
    Number.isFinite(rawMinutes) && rawMinutes > 0
      ? Math.min(rawMinutes, ANNOUNCEMENT_LIMITS.expiryMinutes)
      : 0;

  return { message, level, detail, href, expiresInMinutes };
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

let hydrating: Promise<void> | null = null;

/** Load the disk snapshot once per process, before the first read/write. */
async function hydrate(): Promise<void> {
  const state = announcementState();
  if (state.hydrated) return;

  if (!hydrating) {
    hydrating = (async () => {
      try {
        const raw = await readFile(PERSIST_FILE, "utf8");
        const parsed = JSON.parse(raw) as { version?: number; announcement?: Announcement | null };
        if (parsed?.version === PERSIST_VERSION && parsed.announcement?.message) {
          state.current = parsed.announcement;
        }
      } catch {
        // No snapshot yet, or an unreadable volume — start empty.
      } finally {
        state.hydrated = true;
        hydrating = null;
      }
    })();
  }

  await hydrating;
}

async function persist(): Promise<void> {
  const state = announcementState();
  try {
    if (!state.current) {
      await rm(PERSIST_FILE, { force: true });
      return;
    }
    await writeFile(
      PERSIST_FILE,
      JSON.stringify({ version: PERSIST_VERSION, announcement: state.current }),
      "utf8"
    );
  } catch {
    // A read-only filesystem only costs durability across restarts.
  }
}

/* -------------------------------------------------------------------------- */
/* Public interface                                                            */
/* -------------------------------------------------------------------------- */

/** The announcement currently in effect, or `null`. */
export async function getAnnouncement(): Promise<Announcement | null> {
  await hydrate();
  const state = announcementState();

  if (state.current && !isAnnouncementLive(state.current)) {
    // Expired: drop it lazily so the banner endpoint stays cheap.
    state.current = null;
    void persist();
  }

  return state.current;
}

/** Publish (or replace) the live announcement. */
export async function publishAnnouncement(
  input: ReturnType<typeof normalizeAnnouncementInput>,
  actor: string
): Promise<Announcement> {
  await hydrate();

  const now = Date.now();
  const announcement: Announcement = {
    id: `ann_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    message: input.message,
    level: input.level,
    detail: input.detail,
    href: input.href,
    publishedAt: now,
    expiresAt: input.expiresInMinutes > 0 ? now + input.expiresInMinutes * 60_000 : 0,
    publishedBy: actor,
  };

  announcementState().current = announcement;
  await persist();

  return announcement;
}

/** Remove the live announcement. Returns true when something was cleared. */
export async function clearAnnouncement(): Promise<boolean> {
  await hydrate();
  const state = announcementState();
  const had = Boolean(state.current);
  state.current = null;
  await persist();
  return had;
}
