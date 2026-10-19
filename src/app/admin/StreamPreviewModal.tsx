"use client";

import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { ExternalLink, MonitorPlay, RefreshCw, Signal, TriangleAlert, X } from "lucide-react";
import type { AdminStreamRow } from "@/types/admin";

/**
 * Quick live preview of one stream, for the admin console.
 *
 * A health probe can only report that an origin answered a request — it cannot
 * tell you the payload was a playable picture. This modal plays the stream
 * through the existing proxy so an operator can confirm uptime visually before
 * either publishing a fix or writing the channel off.
 *
 * Deliberately *not* the full player: no overlays, no resume, no favorites. It
 * loads, it plays, and if it fails it says so with the stage it failed at —
 * manifest vs media — which is the diagnostic that matters here.
 *
 * Playback always goes through `/api/proxy`. Raw origins are frequently plain
 * `http://`, which the browser blocks as mixed content on an `https` page, and
 * cross-origin segments are routinely CORS-restricted. The proxy is also what
 * makes the `X-Proxy-Error` header readable in the error state below.
 */

/** Set by the player: which stage gave up. */
type FailStage = "manifest" | "media" | "license";

interface PreviewState {
  status: "loading" | "playing" | "failed";
  stage?: FailStage;
  message?: string;
}

const MAX_RETRIES = 2;

export default function StreamPreviewModal({
  row,
  onClose,
  onRecheck,
}: {
  row: AdminStreamRow;
  onClose: () => void;
  /** Called after the operator asks for a re-probe, so the table can refresh. */
  onRecheck?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [recheck, setRecheck] = useState(false);

  const proxyUrl = `/api/proxy?url=${encodeURIComponent(row.url)}`;

  /* ---------------------------------------------------------------------- */
  /* Playback                                                                */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let hls: Hls | null = null;
    let lastStage: FailStage | undefined;

    const fail = (stage: FailStage, message: string) => {
      if (cancelled) return;
      lastStage = stage;
      setPreview({ status: "failed", stage, message });
    };

    const onPlaying = () => {
      if (cancelled) return;
      setPreview({ status: "playing" });
    };

    const onWaiting = () => {
      if (cancelled || lastStage) return;
      // Buffering is not failure — only surface it if nothing has played yet.
      setPreview((current) =>
        current.status === "playing" ? current : { status: "loading" }
      );
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);

    const load = () => {
      // Native HLS covers Safari/iOS; hls.js covers everything else.
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = proxyUrl;
        video.play().catch(() => {
          // Autoplay refusal is not an error state: show the poster and let the
          // operator press play.
        });
        return;
      }

      if (!Hls.isSupported()) {
        fail("license", "This browser supports neither native HLS nor MSE playback.");
        return;
      }

      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        manifestLoadingMaxRetry: 1,
        manifestLoadingTimeOut: 5_000,
        levelLoadingTimeOut: 10_000,
        fragLoadingTimeOut: 20_000,
        fragLoadingRetryDelay: 1_500,
        manifestLoadingRetryDelay: 1_000,
        maxBufferLength: 12,
        maxMaxBufferLength: 30,
        startFragPrefetch: true,
        capLevelToPlayerSize: true,
      });

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (!cancelled && hls) hls.loadSource(proxyUrl);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        setPreview((current) => (current.status === "playing" ? current : { status: "loading" }));
        video.play().catch(() => undefined);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled || !data.fatal) return;

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          const isManifest =
            data.details === "manifestLoadError" || data.details === "manifestLoadTimeOut";

          // One in-modal retry: transient 502s from the upstream CDN are common
          // and an operator should not have to close and reopen to learn that.
          if (retry < MAX_RETRIES) {
            setRetry((value) => value + 1);
            return;
          }

          fail(
            isManifest ? "manifest" : "media",
            isManifest
              ? "Manifest could not be fetched — the origin or proxy refused the request."
              : "Media segment could not be fetched — the stream started but stopped delivering."
          );
          hls?.destroy();
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
          return;
        }

        fail("license", `Playback error: ${data.details}`);
        hls?.destroy();
      });

      hls.attachMedia(video);
    };

    load();

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      if (hls) {
        hls.destroy();
        hls = null;
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [proxyUrl, retry]);

  /* ---------------------------------------------------------------------- */
  /* Escape to close                                                         */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    // Free the audio if the operator navigates away with the modal open.
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const runRecheck = async () => {
    if (recheck) return;
    setRecheck(true);
    try {
      await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "health-check" }),
      });
      onRecheck?.();
    } finally {
      setRecheck(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${row.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-3xl border border-white/15 bg-[#0b0e16] shadow-[0_40px_120px_-40px_rgba(0,0,0,1)] overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-white/10">
          <span className="w-9 h-9 flex-shrink-0 rounded-xl bg-gradient-to-tr from-cyan-500/25 to-indigo-500/25 border border-white/10 flex items-center justify-center text-cyan-300">
            <MonitorPlay className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-50 truncate">{row.name}</h2>
            <p className="text-[11px] text-slate-500 truncate">
              {row.category || "Uncategorised"}
              {row.country ? ` · ${row.country}` : ""} ·{" "}
              <span
                className={
                  row.status === "live"
                    ? "text-emerald-400"
                    : row.status === "dead"
                      ? "text-rose-400"
                      : "text-amber-400"
                }
              >
                {row.status === "live" ? "Online" : row.status === "dead" ? "Offline" : "Unverified"}
              </span>
              {row.status !== "unknown" && row.error ? ` · ${row.error}` : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 hover:bg-white/10 hover:text-slate-200 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Player */}
        <div className="relative aspect-video bg-black">
          <video
            ref={videoRef}
            controls
            playsInline
            muted
            autoPlay
            className="absolute inset-0 h-full w-full object-contain"
            preload="auto"
          />

          {preview.status === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 pointer-events-none">
              <RefreshCw className="w-6 h-6 text-cyan-300 animate-spin" />
              <p className="mt-3 text-xs text-slate-300">Buffering stream…</p>
            </div>
          )}

          {preview.status === "failed" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 px-6 text-center">
              <TriangleAlert className="w-7 h-7 text-amber-400" />
              <p className="mt-3 text-sm font-bold text-slate-100">
                {preview.stage === "manifest"
                  ? "Stream unavailable (manifest)"
                  : preview.stage === "media"
                    ? "Stream started but stopped (segments)"
                    : "Playback not supported here"}
              </p>
              <p className="mt-1.5 text-[11px] text-slate-400 max-w-sm leading-relaxed">
                {preview.message}
              </p>
              <button
                type="button"
                onClick={() => setRetry(0)}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Try again
              </button>
            </div>
          )}
        </div>

        {/* Footer: diagnostics + actions */}
        <div className="px-5 py-4 border-t border-white/10">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Signal className="w-3 h-3" />
              {row.status === "unknown" ? (
                "never probed"
              ) : (
                <>
                  last probe {row.latencyMs ? `${row.latencyMs} ms` : "—"}
                  {row.httpStatus ? ` · HTTP ${row.httpStatus}` : ""}
                </>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-slate-600 truncate max-w-[240px]">
                {safeEndpoint(row.url)}
              </span>
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title="Open the raw stream URL in a new tab"
                className="inline-flex items-center gap-1 text-cyan-400/80 hover:text-cyan-300 transition"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a
              href={`/watch?channel=${encodeURIComponent(row.id)}`}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2 text-[11px] font-bold text-cyan-200 hover:bg-cyan-500/20 transition"
            >
              <MonitorPlay className="w-3.5 h-3.5" />
              Open in the player
            </a>

            <button
              type="button"
              onClick={() => void runRecheck()}
              disabled={recheck}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-[11px] font-bold text-slate-200 hover:bg-white/10 disabled:opacity-50 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${recheck ? "animate-spin" : ""}`} />
              Re-probe now
            </button>

            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-[11px] font-semibold text-slate-400 hover:bg-white/10 transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Origin + path only — stream URLs routinely carry signed credentials. */
function safeEndpoint(raw: string): string {
  try {
    const parsed = new URL(raw);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(unparseable url)";
  }
}
