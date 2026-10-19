"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LATENCY_SAMPLE_SIZE,
  classifyConnection,
  measureLatency,
  medianOf,
  readNetworkInfo,
  subscribeNetworkChanges,
} from "@/lib/network-quality";
import {
  UNKNOWN_NETWORK,
  type ConnectionQuality,
  type NetworkSnapshot,
} from "@/types/diagnostics";

interface UseConnectionQualityOptions {
  /** How often to probe, in ms. Only runs while the tab is visible. */
  intervalMs?: number;
  /** Same-origin probe target. */
  pingUrl?: string;
}

/**
 * Continuously grade the viewer's connection.
 *
 * Deliberately merges two sources that fail in opposite directions: the
 * Network Information API (instant, but a coarse estimate that only Chrome
 * implements) and a real round-trip probe to our own origin (accurate, but a
 * given moment can be misleading). See `classifyConnection` for how they are
 * combined.
 *
 * The initial state is a fixed neutral snapshot rather than a live reading, so
 * server and client render identically on the first pass — no hydration
 * mismatch, and the widget shows "checking" for the few milliseconds until the
 * first probe lands instead of flashing a wrong verdict.
 */
export function useConnectionQuality({
  intervalMs = 10_000,
  pingUrl = "/api/ping",
}: UseConnectionQualityOptions = {}): {
  quality: ConnectionQuality;
  snapshot: NetworkSnapshot;
} {
  const [snapshot, setSnapshot] = useState<NetworkSnapshot>(UNKNOWN_NETWORK);
  const samplesRef = useRef<number[]>([]);
  /** Probes that have settled, successful or not. */
  const probesRef = useRef(0);

  /**
   * Rebuild the snapshot from the browser's hints plus the probe history.
   *
   * Kept as a plain callback so every `setState` below happens from an event
   * handler or a promise callback — never synchronously inside an effect body.
   */
  const refresh = useCallback(() => {
    setSnapshot({
      ...readNetworkInfo(),
      latencyMs: medianOf(samplesRef.current),
      latencySamples: samplesRef.current.length,
      probes: probesRef.current,
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    const probe = () => {
      void measureLatency(pingUrl).then((ms) => {
        if (cancelled) return;
        probesRef.current += 1;
        if (ms !== null) {
          samplesRef.current = [...samplesRef.current, ms].slice(-LATENCY_SAMPLE_SIZE);
        }
        refresh();
      });
    };

    // First reading arrives as soon as the promise resolves.
    probe();

    const timer = window.setInterval(() => {
      // Never burn a viewer's mobile data probing a tab they are not looking
      // at — and a backgrounded tab's timing is not representative anyway.
      if (document.visibilityState === "visible") probe();
    }, intervalMs);

    // Radio-class and online/offline changes update instantly; no need to wait
    // for the next probe to notice the phone just lost signal.
    const unsubscribe = subscribeNetworkChanges(refresh);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [intervalMs, pingUrl, refresh]);

  return { quality: classifyConnection(snapshot), snapshot };
}
