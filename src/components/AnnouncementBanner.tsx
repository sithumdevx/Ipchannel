"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";

/**
 * Site-wide broadcast banner.
 *
 * Delivery model: the admin publishes once to `/api/admin/announcement`, and
 * every client polls the *public* `/api/announcement` on a short interval plus
 * on refocus. That is what makes "instantly" true without a websocket layer —
 * the first poll after publication returns the new banner, and a cleared one
 * vanishes on the next poll rather than lingering in a cache (`no-store` on
 * both ends).
 *
 * Two details that are easy to get wrong and are handled here:
 *
 *  - **Scroll offset.** The banner is the first thing in the document flow and
 *    sticky, so it displaces everything below it. Rather than leave the page's
 *    own sticky headers underneath it, the banner publishes its measured height
 *    as `--site-banner-h` on `<html>`; a single rule in `globals.css` then moves
 *    every `sticky top-0` header down by exactly that much, and removes it again
 *    when the banner is dismissed or expires.
 *  - **Dismissal is per-banner, not global.** Closing the notice hides *that*
 *    id for the current tab session. A genuinely new broadcast (different id)
 *    shows up immediately, so dismissing yesterday's maintenance notice cannot
 *    suppress today's outage alert.
 */

const POLL_MS = 20_000;

interface LiveAnnouncement {
  id: string;
  message: string;
  level: "info" | "success" | "warning" | "critical";
  detail?: string;
  href?: string;
  publishedAt: number;
  expiresAt: number;
}

const LEVELS: Record<
  LiveAnnouncement["level"],
  { color: string; background: string; icon: React.ReactNode; label: string }
> = {
  info: {
    color: "#38bdf8",
    background: "rgba(56,189,248,0.12)",
    icon: <Info className="w-4 h-4" />,
    label: "Information",
  },
  success: {
    color: "#34d399",
    background: "rgba(52,211,153,0.12)",
    icon: <CircleCheck className="w-4 h-4" />,
    label: "Resolved",
  },
  warning: {
    color: "#fbbf24",
    background: "rgba(251,191,36,0.14)",
    icon: <TriangleAlert className="w-4 h-4" />,
    label: "Notice",
  },
  critical: {
    color: "#fb7185",
    background: "rgba(251,113,133,0.16)",
    icon: <CircleX className="w-4 h-4" />,
    label: "Critical",
  },
};

const DISMISS_KEY = "streampulse_announcement_dismissed";

function readDismissed(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(DISMISS_KEY);
  } catch {
    // Private-mode or blocked storage: dismissal simply does not persist, which
    // is a cosmetic loss, not a functional one.
    return null;
  }
}

function writeDismissed(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(DISMISS_KEY, id);
    else window.sessionStorage.removeItem(DISMISS_KEY);
  } catch {
    /* see readDismissed */
  }
}

export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<LiveAnnouncement | null>(null);
  /**
   * Read on the client's first render rather than in an effect: the banner is
   * `null` until the first poll returns, so the very first render renders
   * nothing on *both* server and client — the value can never disagree across
   * hydration, which is the usual reason sessionStorage has to wait for an
   * effect.
   */
  const [dismissedId, setDismissedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readDismissed()
  );
  const ref = useRef<HTMLElement | null>(null);
  /** Stops a slow in-flight poll from overwriting a newer state. */
  const generation = useRef(0);

  const apply = useCallback((next: LiveAnnouncement | null) => {
    generation.current += 1;
    // Expired banners are dropped client-side too, so a visitor between polls
    // does not keep seeing something the server would already refuse.
    if (next && next.expiresAt && next.expiresAt <= Date.now()) next = null;
    setAnnouncement(next);
  }, []);

  /**
   * Written as a promise chain rather than `async`/`await` on purpose: the
   * state update lives inside a `.then` callback, so it is reached only after
   * the request resolves. That is what makes it a *subscription* to an external
   * source rather than a state change performed by the effect itself — the
   * distinction `react-hooks/set-state-in-effect` is asking for.
   */
  const poll = useCallback(() => {
    const ticket = generation.current + 1;
    generation.current = ticket;

    fetch("/api/announcement", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { active?: boolean; announcement?: LiveAnnouncement } | null) => {
        if (generation.current !== ticket) return; // a newer poll already won
        apply(payload?.active && payload.announcement ? payload.announcement : null);
      })
      .catch(() => {
        // A transient network blip must never surface as an error banner; the
        // next tick retries, and the previous banner simply stays up meanwhile.
      });
  }, [apply]);

  /* ---------------------------------------------------------------------- */
  /* Poll: on mount, on an interval, and whenever the tab returns to focus    */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    void poll();

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);

    const onFocus = () => void poll();
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  /* ---------------------------------------------------------------------- */
  /* Publish the measured height so sticky headers can sit below it          */
  /* ---------------------------------------------------------------------- */

  useLayoutEffect(() => {
    const root = document.documentElement;
    const node = ref.current;

    if (!announcement || !node) {
      root.style.removeProperty("--site-banner-h");
      root.removeAttribute("site-banner");
      return;
    }

    const sync = () => {
      root.style.setProperty("--site-banner-h", `${node.offsetHeight}px`);
      root.setAttribute("site-banner", "on");
    };

    sync();

    // The banner can reflow (a longer message wraps on a narrow screen), so the
    // offset has to track it rather than being measured once.
    const observer = new ResizeObserver(sync);
    observer.observe(node);

    return () => {
      observer.disconnect();
      root.style.removeProperty("--site-banner-h");
      root.removeAttribute("site-banner");
    };
  }, [announcement]);

  if (!announcement || dismissedId === announcement.id) return null;

  const level = LEVELS[announcement.level] ?? LEVELS.info;
  const dismiss = () => {
    setDismissedId(announcement.id);
    writeDismissed(announcement.id);
  };

  const body = (
    <div className="mx-auto max-w-7xl px-3 sm:px-6 py-2 flex items-start gap-2.5 sm:gap-3">
      <span
        className="mt-0.5 flex-shrink-0"
        style={{ color: level.color }}
        aria-hidden="true"
      >
        {level.icon}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs sm:text-[13px] leading-snug">
          <span
            className="flex-shrink-0 text-[9px] font-black uppercase tracking-[0.14em]"
            style={{ color: level.color }}
          >
            {level.label}
          </span>
          <span className="font-semibold text-slate-100 break-words">{announcement.message}</span>
        </p>

        {announcement.detail && (
          <p className="text-[11px] text-slate-400 mt-0.5 break-words leading-relaxed">
            {announcement.detail}
          </p>
        )}
      </div>

      {announcement.href && (
        <Link
          href={announcement.href}
          className="flex-shrink-0 self-center rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition hover:brightness-125"
          style={{
            color: level.color,
            borderColor: `${level.color}66`,
            background: `${level.color}1a`,
          }}
        >
          Details
        </Link>
      )}

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss this notice"
        title="Dismiss until a new notice is published"
        className="flex-shrink-0 self-center rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  // `role="status"` rather than `alert`: a banner appearing while someone is
  // watching video should be announced by a screen reader, not interrupt them.
  return (
    <aside
      ref={ref}
      id="site-announcement-banner"
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[45] border-b backdrop-blur-xl"
      style={{
        background: level.background,
        borderColor: `${level.color}4d`,
        boxShadow: `inset 0 -1px 0 ${level.color}26`,
      }}
    >
      {body}
    </aside>
  );
}
