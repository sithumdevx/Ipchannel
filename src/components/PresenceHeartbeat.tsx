"use client";

import { useEffect, useState } from "react";
import type { Channel } from "@/types/iptv";

/**
 * Viewer presence heartbeat.
 *
 * Posts a small "I am watching this channel" signal to `/api/presence` so the
 * admin dashboard can report concurrent viewers and a most-watched leaderboard.
 * The app has no other source for that: watch history lives in the browser and
 * Supabase only stores favorites.
 *
 * Deliberately self-contained and silent. Playback must never depend on
 * telemetry, so every failure is swallowed, the request is never retried in a
 * loop, and a missing `crypto.randomUUID` (non-secure contexts) falls back to a
 * random id rather than throwing.
 */

const HEARTBEAT_MS = 30_000;
const STORAGE_KEY = "streampulse_viewer_session";

/** A stable per-tab id, so one viewer stays one session across channel switches. */
function viewerSessionId(): string {
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) return existing;

    const generated =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replace(/-/g, "")
        : `s${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    sessionStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    // Private mode / storage disabled: fall back to an ephemeral id.
    return `s${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

function channelPayload(channel: Channel) {
  return {
    id: channel.id,
    name: channel.name,
    category: channel.category,
    country: channel.country,
  };
}

export default function PresenceHeartbeat({ channel }: { channel: Channel | null }) {
  // Resolved once per mount through a lazy initialiser rather than read off a
  // ref during render. The id is persisted in `sessionStorage`, so a remount of
  // this component (or a route change that re-renders the player) re-reads the
  // same value and one viewer stays one session.
  //
  // The component renders `null`, so the server's throwaway value and the
  // client's stored one are never compared — hydration cannot disagree.
  const [sessionId] = useState(viewerSessionId);

  // Heartbeat + immediate beat on every channel switch. The session id is
  // stable, so switching channels reads as one viewer moving, not a new viewer.
  useEffect(() => {
    if (!channel) return;

    const body = JSON.stringify({
      sessionId,
      channel: channelPayload(channel),
    });
    const beat = () => {
      void fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        /* Telemetry is best-effort; playback never depends on it. */
      });
    };

    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [channel, sessionId]);

  // Tell the server when this viewer actually leaves. Covers both unmount
  // (leaving the player) and tab close, so concurrency drops immediately instead
  // of lingering for the whole presence window.
  useEffect(() => {
    const leave = () => {
      const body = JSON.stringify({ sessionId, leave: true });
      try {
        navigator.sendBeacon?.(
          "/api/presence",
          new Blob([body], { type: "application/json" })
        );
      } catch {
        /* ignore — the session simply expires with the window */
      }
    };

    const onHidden = () => {
      if (document.visibilityState === "hidden") leave();
    };

    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", onHidden);

    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [sessionId]);

  return null;
}
