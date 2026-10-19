"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  Maximize,
  Minimize,
  RotateCw,
  Tv,
  WifiOff,
  SkipForward,
  ChevronLeft,
  Radio,
  PictureInPicture,
  Settings,
  ShieldCheck,
  ShieldAlert,
  TrendingDown,
  Zap,
} from "lucide-react";
import { Channel } from "@/types/iptv";
import { countryFlag, countryLabel } from "@/lib/countries";
import { cleanChannelTitle } from "@/lib/channel-display";
import { publishTelemetry, resetTelemetry } from "@/lib/player-telemetry";
import type { StreamState } from "@/types/diagnostics";

interface VideoPlayerProps {
  channel: Channel;
  onClose?: () => void;
  onNextChannel?: () => void;
  onPrevChannel?: () => void;
}

/**
 * WebKit-prefixed fullscreen typings.
 *
 * iOS/iPadOS Safari never exposed the standard Fullscreen API on iPhone (and
 * only partially on older iPads) — instead the <video> element owns a native
 * fullscreen controller entered through `webkitEnterFullscreen()`. Supporting
 * both paths is what makes the fullscreen button actually work on mobile.
 */
type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
};
type WebkitContainer = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/** Seconds the "Stream Offline" card waits before auto-advancing. */
const AUTO_SKIP_SECONDS = 6;

export default function VideoPlayer({
  channel,
  onClose,
  onNextChannel,
  onPrevChannel,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [useProxy, setUseProxy] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [qualities, setQualities] = useState<{ id: number; name: string }[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1); // -1 is Auto level switching
  const [autoResolution, setAutoResolution] = useState<string>("");
  const [showQualityMenu, setShowQualityMenu] = useState<boolean>(false);
  /** Seconds until the offline card auto-advances; `null` = no countdown. */
  const [autoSkipIn, setAutoSkipIn] = useState<number | null>(null);
  /** Rendering resolution after an automatic downscale; `null` = notice hidden. */
  const [qualityNotice, setQualityNotice] = useState<string | null>(null);

  // Recovery counters live in refs so updating them never re-creates
  // `loadStream` — otherwise the load effect would re-run and restart the
  // stream in the middle of a retry.
  const networkRetriesRef = useRef<number>(0);
  const mediaRecoveriesRef = useRef<number>(0);
  /** Error signatures already logged for the current stream (spam control). */
  const loggedErrorsRef = useRef<Set<string>>(new Set());
  /** Streams already reported to the verifier this session (dedupe). */
  const reportedStreamsRef = useRef<Set<string>>(new Set());
  /** True once direct playback has fallen back to the proxy. */
  const proxyFallbackRef = useRef<boolean>(false);
  /** Stream URL we last reset per-channel recovery state for. */
  const lastStreamUrlRef = useRef<string | null>(null);

  /**
   * Telemetry facts that cannot be read off a DOM property, plus the level the
   * last switch left us on. Held in a ref so the sampler below never has to be
   * recreated — recreating it would restart the sampling interval — and never
   * reads stale state from a render it did not see.
   */
  const telemetryRef = useRef({
    stream: "idle" as StreamState,
    resolution: null as string | null,
    auto: true,
    downgrades: 0,
    lastLevelIndex: -1,
  });

  /** Auto-hide timer for the bandwidth notice. */
  const qualityNoticeRef = useRef<NodeJS.Timeout | null>(null);

  // Latest navigation callbacks, read through refs so `markOffline` — and
  // therefore `loadStream` — stays referentially stable across parent renders.
  const onNextRef = useRef(onNextChannel);
  const onPrevRef = useRef(onPrevChannel);
  useEffect(() => {
    onNextRef.current = onNextChannel;
    onPrevRef.current = onPrevChannel;
  });

  /**
   * Publish a fresh diagnostics snapshot.
   *
   * Everything that changes continuously — buffer depth, dropped frames, the
   * bandwidth estimate — is read from the live element here rather than being
   * mirrored into React state, so sampling never re-renders the player itself.
   * The store drops unchanged snapshots, and it is subscribed to by exactly one
   * small widget, so a steady 2s tick costs essentially nothing.
   */
  const pushTelemetry = useCallback(() => {
    const video = videoRef.current;
    const hls = hlsRef.current;
    const facts = telemetryRef.current;

    // Seconds of media buffered ahead of the playhead: the range covering it,
    // since a live stream can hold several disjoint ranges.
    let bufferSeconds: number | null = null;
    if (video) {
      const ranges = video.buffered;
      for (let i = 0; i < ranges.length; i += 1) {
        if (
          video.currentTime >= ranges.start(i) - 0.25 &&
          video.currentTime <= ranges.end(i)
        ) {
          bufferSeconds = Math.max(0, ranges.end(i) - video.currentTime);
          break;
        }
      }
    }

    // Dropped-frame share, where the browser exposes playback quality stats.
    let droppedRatio: number | null = null;
    const qualityStats = video?.getVideoPlaybackQuality?.();
    if (qualityStats && qualityStats.totalVideoFrames > 0) {
      droppedRatio = qualityStats.droppedVideoFrames / qualityStats.totalVideoFrames;
    }

    const estimate = hls?.bandwidthEstimate;

    publishTelemetry({
      stream: facts.stream,
      resolution: facts.resolution,
      auto: facts.auto,
      bandwidthBps:
        typeof estimate === "number" && estimate > 0 ? Math.round(estimate) : null,
      bufferSeconds: bufferSeconds === null ? null : Math.round(bufferSeconds),
      droppedRatio,
      downgrades: facts.downgrades,
    });
  }, []);

  /**
   * Tell the viewer, gently, that the picture just got smaller on purpose.
   *
   * Only raised for automatic downscales — never when someone picked a level by
   * hand. Repeated downscales in a cascade reuse the one notice and restart its
   * timer, so the message tracks the final resolution instead of stacking.
   */
  const showQualityNotice = useCallback((resolution: string) => {
    setQualityNotice(resolution || "lower quality");
    if (qualityNoticeRef.current) clearTimeout(qualityNoticeRef.current);
    qualityNoticeRef.current = setTimeout(() => setQualityNotice(null), 6000);
  }, []);

  // Derive target stream URL based on proxy state
  const getStreamUrl = useCallback(
    (streamUrl: string, proxyEnabled: boolean) => {
      if (proxyEnabled) {
        return `/api/proxy?url=${encodeURIComponent(streamUrl)}`;
      }
      return streamUrl;
    },
    []
  );

  /**
   * Show the "Stream Offline or Unavailable" card and tell the background
   * verifier about the failure, so a genuinely dead endpoint is marked offline
   * and filtered out of the active listings within the next refresh.
   */
  const markOffline = useCallback(
    (message: string) => {
      telemetryRef.current.stream = "offline";
      telemetryRef.current.auto = true;
      pushTelemetry();
      // A quality notice is meaningless once the stream has failed.
      if (qualityNoticeRef.current) clearTimeout(qualityNoticeRef.current);
      setQualityNotice(null);
      setIsLoading(false);
      setIsPlaying(false);
      setErrorMessage(message);
      setShowControls(true);
      setAutoSkipIn(onNextRef.current ? AUTO_SKIP_SECONDS : null);

      const url = channel.url;
      if (url && !reportedStreamsRef.current.has(url)) {
        reportedStreamsRef.current.add(url);
        // Fire-and-forget: the server re-probes the origin and records the
        // verdict, which is what drives server-side health filtering.
        void fetch(`/api/health?check=${encodeURIComponent(url)}&force=1`, {
          method: "GET",
          keepalive: true,
        }).catch(() => {
          /* best-effort only */
        });
      }
    },
    [channel.url, pushTelemetry]
  );

  // Initialize and load HLS stream with optimized buffer & auto level switching
  const loadStream = useCallback(
    (streamUrl: string, proxyState: boolean) => {
      const video = videoRef.current;
      if (!video) return;

      // Reset per-stream recovery state whenever the channel changes.
      if (lastStreamUrlRef.current !== streamUrl) {
        lastStreamUrlRef.current = streamUrl;
        networkRetriesRef.current = 0;
        mediaRecoveriesRef.current = 0;
        proxyFallbackRef.current = false;
        loggedErrorsRef.current = new Set();
        // Diagnostics are per-stream as well: a "2 step-downs" badge must never
        // carry over from the channel the viewer just left.
        telemetryRef.current.downgrades = 0;
        telemetryRef.current.resolution = null;
        telemetryRef.current.lastLevelIndex = -1;
      }

      // Fresh channel or a manual reload — the widget should read "Buffering"
      // until the element actually presents frames again.
      telemetryRef.current.stream = "buffering";
      // A newly constructed Hls instance always starts in auto mode, so a
      // quality the viewer pinned on the previous stream must not survive it.
      telemetryRef.current.auto = true;
      setCurrentQuality(-1);
      if (qualityNoticeRef.current) clearTimeout(qualityNoticeRef.current);
      setQualityNotice(null);
      pushTelemetry();

      setIsLoading(true);
      setErrorMessage(null);
      setAutoSkipIn(null);

      // Clean up previous HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const activeUrl = getStreamUrl(streamUrl, proxyState);

      if (Hls.isSupported()) {
        const hls = new Hls({
          // ── Execution ──────────────────────────────────────────────────────
          // Parse and demux off the main thread. On the low-end Android
          // handsets that dominate this audience that is the difference
          // between a responsive UI and a frozen one.
          enableWorker: true,
          // Low-latency HLS trades stability for a shorter delay. On a
          // congested 4G cell that trade is the wrong way round: the viewer
          // wants smooth, not three seconds fresher.
          lowLatencyMode: false,

          // ── Adaptive bitrate ───────────────────────────────────────────────
          // Let hls.js choose, capped to the size actually being rendered so we
          // never pay for pixels nobody can see.
          startLevel: -1,
          capLevelToPlayerSize: true,
          capLevelOnFPSDrop: true,
          // Open streams at a realistic level. hls.js assumes 5 Mbps before its
          // first sample, which is not a sane opening bid on a metered Sri
          // Lankan mobile plan — but the very bottom rung is needlessly
          // pessimistic when the link is fine.
          abrEwmaDefaultEstimate: 800_000,
          abrEwmaDefaultEstimateMax: 5_000_000,
          // React to a collapse quickly, recover slowly. That asymmetry is the
          // whole point on a link that flaps: downgrading late means a stall,
          // climbing eagerly means oscillation. (These match the defaults; they
          // are stated because the asymmetry is deliberate, not incidental.)
          abrEwmaFastLive: 3,
          abrEwmaSlowLive: 9,
          // Require ~15% headroom before a level is used at all, and ~40%
          // before climbing back up (library defaults: 0.95 / 0.7).
          abrBandWidthFactor: 0.85,
          abrBandWidthUpFactor: 0.6,
          maxStarvationDelay: 4,
          maxLoadingDelay: 4,

          // ── Buffers ────────────────────────────────────────────────────────
          // 30s ahead is ample for a 4G hiccup. A longer buffer does not buy
          // resilience: hls.js fills it at a level the link cannot sustain and
          // then stalls when it runs dry, which is exactly the buffering loop
          // this audience reports.
          maxBufferLength: 30,
          // Cap the adaptive doubling at 60s. The library default of 600s is
          // far too greedy on a metered connection.
          maxMaxBufferLength: 60,
          // Hard 30 MB ceiling on buffered media — mobile data is not free here.
          maxBufferSize: 30 * 1000 * 1000,
          // Keep 30s behind the playhead so seeking back stays instant.
          backBufferLength: 30,
          // Tolerate small timeline gaps instead of nudging/seeking, which is
          // what produces the audible glitch on a lossy mobile link.
          maxBufferHole: 0.3,
          highBufferWatchdogPeriod: 2,
          // Fetch the first fragment while playlist levels are still parsing.
          startFragPrefetch: true,
          testBandwidth: true,

          // ── Live latency ───────────────────────────────────────────────────
          // Sit three target durations behind the live edge (library default),
          // but never drift past eight before a catch-up seek — without a
          // ceiling, playback quietly falls further behind on a weak link.
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 8,

          // ── Timeouts & retries ─────────────────────────────────────────────
          // The manifest budget sits just above the proxy's 5s upstream
          // timeout, so a slow-but-alive origin still wins while a dead one
          // fails over to recovery (or the offline card) instead of leaving
          // the spinner spinning.
          manifestLoadingTimeOut: 12000,
          levelLoadingTimeOut: 12000,
          fragLoadingTimeOut: 30000,
          // Extra attempts ride out a momentary 4G dropout without surfacing an
          // error, since a handover-induced stall is normal, not exceptional.
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 3,
          fragLoadingMaxRetry: 6,
          // Allow a few nudges to resync a stalled decoder before giving up.
          nudgeMaxRetry: 5,
        });

        hlsRef.current = hls;
        hls.attachMedia(video);

        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          hls.loadSource(activeUrl);
        });

        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          setIsLoading(false);
          setErrorMessage(null);
          setAutoSkipIn(null);
          networkRetriesRef.current = 0;
          mediaRecoveriesRef.current = 0;

          const levels = data.levels.map((lvl, index) => ({
            id: index,
            name: lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)}k`,
          }));
          setQualities(levels);

          video.play().catch(() => {
            setIsPlaying(false);
            telemetryRef.current.stream = "paused";
            pushTelemetry();
          });
        });

        // Track level changes: the resolution on screen, whether adaptive
        // bitrate is still in charge, and — the interesting part — any
        // automatic step *down*, which is the moment to tell the viewer why the
        // picture just got softer instead of letting them wonder.
        hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
          if (data.level < 0 || !hls.levels[data.level]) return;

          const level = hls.levels[data.level];
          const resolution = level.height ? `${level.height}p` : "";
          const previous = telemetryRef.current.lastLevelIndex;
          const isAuto = hls.autoLevelEnabled;

          setAutoResolution(resolution);

          if (
            isAuto &&
            previous >= 0 &&
            data.level < previous &&
            (hls.levels[previous]?.bitrate ?? 0) > (level.bitrate ?? 0)
          ) {
            telemetryRef.current.downgrades += 1;
            showQualityNotice(resolution);
          }

          telemetryRef.current.lastLevelIndex = data.level;
          telemetryRef.current.resolution = resolution || null;
          telemetryRef.current.auto = isAuto;
          pushTelemetry();
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          // Log each distinct failure only once per stream — a flapping origin
          // can otherwise emit hundreds of identical errors and drown the
          // console (the old behaviour spammed one line per failed fragment).
          const signature = `${data.type}:${data.details}`;
          if (!loggedErrorsRef.current.has(signature)) {
            loggedErrorsRef.current.add(signature);
            console.warn(
              "[StreamPulse] HLS:",
              data.type,
              data.details,
              data.fatal ? "(fatal)" : ""
            );
          }

          if (!data.fatal) return;

          const manifestFailed =
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR;

          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // 1) Direct playback failed (CORS, geo, dead manifest) — retry
              //    once through the same-origin proxy. Flipping `useProxy`
              //    re-runs the load effect for us.
              if (!proxyState && !proxyFallbackRef.current) {
                proxyFallbackRef.current = true;
                console.info("[StreamPulse] Direct playback failed — retrying via proxy…");
                setUseProxy(true);
                return;
              }

              // 2) A couple of quick retries to ride out transient hiccups.
              if (networkRetriesRef.current < 2) {
                networkRetriesRef.current += 1;
                const delay = 800 * networkRetriesRef.current;
                window.setTimeout(() => {
                  if (hlsRef.current === hls) {
                    setIsLoading(true);
                    hls.startLoad();
                  }
                }, delay);
                return;
              }

              // 3) Give up — show the sleek offline state.
              hls.destroy();
              if (hlsRef.current === hls) hlsRef.current = null;
              markOffline(
                manifestFailed
                  ? "The stream source isn't responding. It may be offline, geo-blocked, or rate-limited."
                  : "The stream stopped sending data. Your connection may be unstable, or the source went offline."
              );
              return;

            case Hls.ErrorTypes.MEDIA_ERROR:
              // Recover once with a plain media-error recovery, then with an
              // audio-codec swap, and only then give up.
              if (mediaRecoveriesRef.current < 1) {
                mediaRecoveriesRef.current += 1;
                hls.recoverMediaError();
                return;
              }
              if (mediaRecoveriesRef.current < 2) {
                mediaRecoveriesRef.current += 1;
                hls.swapAudioCodec();
                hls.recoverMediaError();
                return;
              }
              hls.destroy();
              if (hlsRef.current === hls) hlsRef.current = null;
              markOffline(
                "This channel couldn't be decoded — it may be offline or use an unsupported format."
              );
              return;

            default:
              hls.destroy();
              if (hlsRef.current === hls) hlsRef.current = null;
              markOffline(
                "This stream is unavailable or uses a format this player can't handle."
              );
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS support for Safari / iOS — errors surface on the element.
        video.src = activeUrl;
        video.addEventListener("loadedmetadata", () => {
          setIsLoading(false);
          video.play().catch(() => setIsPlaying(false));
        });
        video.addEventListener("error", () => {
          if (!proxyState && !proxyFallbackRef.current) {
            proxyFallbackRef.current = true;
            setUseProxy(true);
          } else {
            markOffline("The stream is offline or the source is refusing the connection.");
          }
        });
      } else {
        telemetryRef.current.stream = "offline";
        pushTelemetry();
        setIsLoading(false);
        setErrorMessage("HLS playback isn't supported in this browser.");
      }
    },
    [getStreamUrl, markOffline, pushTelemetry, showQualityNotice]
  );

  // Reload when channel or proxy changes
  useEffect(() => {
    loadStream(channel.url, useProxy);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [channel.url, useProxy, loadStream]);

  // Sample the live DOM facts — buffer depth, dropped frames, the bandwidth
  // estimate — on a slow tick. State transitions publish immediately from their
  // own events; this tick only keeps the continuously moving numbers honest.
  useEffect(() => {
    const timer = setInterval(pushTelemetry, 2000);
    return () => clearInterval(timer);
  }, [pushTelemetry]);

  // Don't leave a snapshot (or a pending notice timer) for the next mount.
  useEffect(() => {
    return () => {
      resetTelemetry();
      if (qualityNoticeRef.current) clearTimeout(qualityNoticeRef.current);
    };
  }, []);

  // While the offline card is showing, count down and auto-advance to the next
  // channel. Any interaction (Retry / proxy toggle) clears `autoSkipIn` first.
  useEffect(() => {
    if (autoSkipIn === null) return;
    if (autoSkipIn <= 0) {
      onNextRef.current?.();
      return;
    }
    const timer = setTimeout(() => {
      setAutoSkipIn((prev) => (prev === null ? null : prev - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [autoSkipIn]);

  // Handle Play/Pause
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(console.error);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  // Handle Mute/Unmute
  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  // Handle Volume change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const video = videoRef.current;
    if (!video) return;

    video.volume = val;
    setVolume(val);
    if (val === 0) {
      setIsMuted(true);
      video.muted = true;
    } else if (isMuted) {
      setIsMuted(false);
      video.muted = false;
    }
  };

  // Fullscreen toggle — covers the standard API (Chrome/Edge/Firefox/Android,
  // iPadOS 16.4+), the WebKit-prefixed API (older Safari/iPadOS), and iOS
  // Safari's video-only native fullscreen as the final fallback.
  const toggleFullscreen = useCallback(() => {
    const video = videoRef.current as WebkitVideo | null;
    const container = containerRef.current as WebkitContainer | null;
    const doc = document as WebkitDocument;

    const activeElement = doc.fullscreenElement ?? doc.webkitFullscreenElement;

    // --- Exit -------------------------------------------------------------
    if (activeElement) {
      if (doc.fullscreenElement && doc.exitFullscreen) {
        doc.exitFullscreen().catch(console.error);
      } else if (doc.webkitExitFullscreen) {
        void doc.webkitExitFullscreen();
      }
      return;
    }

    // --- Enter: standard / prefixed element fullscreen --------------------
    const requestFs =
      (container?.requestFullscreen?.bind(container) as (() => Promise<void>) | undefined) ??
      (container?.webkitRequestFullscreen?.bind(container) as
        | (() => Promise<void> | void)
        | undefined);

    if (requestFs) {
      try {
        const result = requestFs() as Promise<void> | void;
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>)
            .then(() => setIsFullscreen(true))
            .catch(() => {
              // Element fullscreen rejected (common on iPhone Safari) — fall
              // back to the native video controller, which rotates to landscape.
              if (video && typeof video.webkitEnterFullscreen === "function") {
                video.webkitEnterFullscreen();
              }
            });
        } else {
          setIsFullscreen(true);
        }
      } catch {
        if (video && typeof video.webkitEnterFullscreen === "function") {
          video.webkitEnterFullscreen();
        }
      }
      return;
    }

    // --- Enter: iOS Safari native video fullscreen ------------------------
    if (video && typeof video.webkitEnterFullscreen === "function") {
      video.webkitEnterFullscreen();
      return;
    }

    console.warn("Fullscreen is not supported in this browser.");
  }, []);

  /**
   * Keep `isFullscreen` in sync with reality.
   *
   * Standard `fullscreenchange` covers desktop/Android; the WebKit events
   * (`webkitfullscreenchange`, plus the non-standard `webkitbegin/endfullscreen`
   * dispatched on the <video> element during iOS native fullscreen) cover
   * Safari — including when the user exits via the native close button or the
   * home indicator rather than our own control.
   */
  useEffect(() => {
    const syncFromDocument = () => {
      const doc = document as WebkitDocument;
      setIsFullscreen(Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement));
    };
    const handleVideoEnter = () => setIsFullscreen(true);
    const handleVideoExit = () => setIsFullscreen(false);

    document.addEventListener("fullscreenchange", syncFromDocument);
    document.addEventListener("webkitfullscreenchange", syncFromDocument);
    // iOS-only native fullscreen transitions (not part of the DOM typings).
    videoRef.current?.addEventListener("webkitbeginfullscreen", handleVideoEnter);
    videoRef.current?.addEventListener("webkitendfullscreen", handleVideoExit);

    return () => {
      document.removeEventListener("fullscreenchange", syncFromDocument);
      document.removeEventListener("webkitfullscreenchange", syncFromDocument);
      videoRef.current?.removeEventListener("webkitbeginfullscreen", handleVideoEnter);
      videoRef.current?.removeEventListener("webkitendfullscreen", handleVideoExit);
    };
  }, []);

  // Picture in picture
  const togglePiP = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch (e) {
      console.warn("PiP failed", e);
    }
  };

  // Change HLS Quality Level: -1 enables Auto Level Switching
  const selectQuality = (levelIndex: number) => {
    const hls = hlsRef.current;
    if (!hls) return;

    hls.currentLevel = levelIndex;
    setCurrentQuality(levelIndex);
    setShowQualityMenu(false);

    // `LEVEL_SWITCHED` will confirm this a moment later, but reflect the mode
    // immediately so the diagnostics badge never claims "Adaptive bitrate"
    // after the viewer has pinned a level by hand.
    telemetryRef.current.auto = levelIndex === -1;
    if (levelIndex >= 0) {
      const level = hls.levels[levelIndex];
      if (level) {
        telemetryRef.current.resolution = level.height ? `${level.height}p` : null;
      }
    }
    pushTelemetry();
  };

  // Auto-hide controls timer
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
        setShowQualityMenu(false);
      }
    }, 3500);
  };

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["input", "textarea"].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "KeyF") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === "KeyM") {
        e.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, isMuted]);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      className="player-fullscreen relative w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 group select-none"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onTouchStart={() => {
          // Tapping the video on mobile re-reveals the controls (and restarts
          // their auto-hide timer) instead of relying on a mouse cursor.
          setShowControls(true);
          handleMouseMove();
        }}
        onPlay={() => {
          setIsPlaying(true);
          telemetryRef.current.stream = "playing";
          pushTelemetry();
        }}
        onPlaying={() => {
          // Fires once frames are actually being presented — the point at which
          // "Buffering" has genuinely ended.
          setIsPlaying(true);
          telemetryRef.current.stream = "playing";
          pushTelemetry();
        }}
        onWaiting={() => {
          // The decoder ran out of data. This is the honest "Buffering" signal,
          // and it arrives long before anything would surface as an error.
          telemetryRef.current.stream = "buffering";
          pushTelemetry();
        }}
        onStalled={() => {
          telemetryRef.current.stream = "buffering";
          pushTelemetry();
        }}
        onPause={() => {
          setIsPlaying(false);
          telemetryRef.current.stream = "paused";
          pushTelemetry();
        }}
        playsInline
        // iOS Safari: keep playback inside the page until the user opts into
        // fullscreen — prevents the video being pushed behind the URL bar.
        webkit-playsinline=""
        x5-playsinline=""
      />

      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-20 pointer-events-none">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Tv className="w-6 h-6 text-cyan-400 animate-pulse" />
            </div>
          </div>
          <span className="mt-4 text-sm font-medium text-slate-200 tracking-wide">
            Buffering {channel.name}...
          </span>
          {useProxy && (
            <span className="mt-1 text-xs text-cyan-400/80 bg-cyan-950/60 px-2 py-0.5 rounded-full border border-cyan-800/50">
              Routing manifest through CORS Proxy (Direct Segments)
            </span>
          )}
        </div>
      )}

      {/* Adaptive-bitrate notice. Raised only for a downscale hls.js chose by
          itself, positioned below the header overlay so it never fights the
          controls, and click-through so it can't intercept a play/pause tap. */}
      {qualityNotice && !errorMessage && (
        <div className="absolute left-1/2 top-[4.25rem] z-30 w-max max-w-[88%] -translate-x-1/2 animate-fade-in pointer-events-none">
          <div className="flex items-center gap-2 rounded-2xl border border-amber-400/40 bg-slate-950/85 px-3.5 py-2 shadow-2xl backdrop-blur-md">
            <TrendingDown className="w-4 h-4 shrink-0 text-amber-400" />
            <p className="text-[11px] font-semibold leading-tight text-amber-100">
              Connection slow — adjusting playback quality for smooth streaming
              <span className="text-amber-300/90"> · {qualityNotice}</span>
            </p>
          </div>
        </div>
      )}

      {/* Stream Offline / Unavailable Overlay */}
      {errorMessage && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-slate-950/92 p-6 text-center backdrop-blur-md">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(244,63,94,0.16),transparent_62%)]" />

          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/20 to-amber-500/10 ring-1 ring-rose-500/30">
            <WifiOff className="h-7 w-7 text-rose-400" />
          </div>

          <div className="relative space-y-1.5">
            <h3 className="text-lg font-bold tracking-tight text-white sm:text-xl">
              Stream Offline or Unavailable
            </h3>
            <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-400">
              {errorMessage}
            </p>
          </div>

          <div className="relative flex flex-wrap items-center justify-center gap-2.5">
            {onNextChannel && (
              <button
                type="button"
                onClick={() => {
                  setAutoSkipIn(null);
                  setErrorMessage(null);
                  onNextChannel();
                }}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-600 px-5 py-2.5 text-sm font-bold text-black shadow-lg shadow-cyan-500/30 transition hover:from-cyan-300 hover:to-blue-500 active:scale-95"
              >
                <SkipForward className="h-4 w-4" />
                Try Next Stream
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setAutoSkipIn(null);
                setErrorMessage(null);
                loadStream(channel.url, useProxy);
              }}
              className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/20 active:scale-95"
            >
              <RotateCw className="h-4 w-4" />
              Retry
            </button>

            <button
              type="button"
              onClick={() => {
                setAutoSkipIn(null);
                setErrorMessage(null);
                setUseProxy(!useProxy);
              }}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white active:scale-95"
            >
              {useProxy ? (
                <>
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                  Try Direct
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Try CORS Proxy
                </>
              )}
            </button>
          </div>

          {autoSkipIn !== null && onNextChannel && (
            <div className="relative flex items-center gap-3">
              <div className="relative h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-[width] duration-1000 ease-linear"
                  style={{ width: `${(autoSkipIn / AUTO_SKIP_SECONDS) * 100}%` }}
                />
              </div>
              <button
                type="button"
                onClick={() => setAutoSkipIn(null)}
                className="text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
              >
                Auto-skip in {autoSkipIn}s — cancel
              </button>
            </div>
          )}

          {onPrevChannel && (
            <button
              type="button"
              onClick={() => {
                setAutoSkipIn(null);
                setErrorMessage(null);
                onPrevChannel();
              }}
              className="relative flex items-center gap-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-200"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous channel
            </button>
          )}
        </div>
      )}

      {/* Top Header Overlay */}
      <div
        className={`absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent z-10 transition-opacity duration-300 flex items-center justify-between ${
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center gap-3">
          {channel.logo ? (
            <img
              src={channel.logo}
              alt={channel.name}
              className="w-9 h-9 object-contain rounded-lg bg-slate-900/80 p-1 border border-white/10"
              onError={(e) => {
                (e.target as HTMLElement).style.display = "none";
              }}
            />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-600 to-indigo-600 flex items-center justify-center font-bold text-white text-xs">
              {channel.name.substring(0, 2).toUpperCase()}
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-white font-semibold text-sm sm:text-base leading-tight drop-shadow truncate max-w-[42vw] sm:max-w-none">
                {cleanChannelTitle(channel.name)}
              </h2>
              <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                LIVE
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-300 mt-0.5">
              <span>{channel.category}</span>
              {channel.country && (
                <>
                  <span>•</span>
                  <span>
                    {countryFlag(channel.country)} {countryLabel(channel.country)}
                  </span>
                </>
              )}
              {autoResolution && currentQuality === -1 && (
                <>
                  <span>•</span>
                  <span className="text-cyan-400 flex items-center gap-0.5">
                    <Zap className="w-3 h-3" />
                    Auto: {autoResolution}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Header Badges: Proxy Switcher & Close */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => {
              const nextProxy = !useProxy;
              setUseProxy(nextProxy);
              loadStream(channel.url, nextProxy);
            }}
            title={useProxy ? "Proxied via Next.js backend (Direct Segments)" : "Direct stream"}
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium backdrop-blur-md border transition ${
              useProxy
                ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                : "bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-700/80"
            }`}
          >
            {useProxy ? (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>{useProxy ? "CORS Proxy: ON" : "Direct Mode"}</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
              title="Close player"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Prominent mobile-only fullscreen button — large touch target that
          triggers the native fullscreen API (landscape video on iOS/Android) */}
      {showControls && !isFullscreen && !isLoading && !errorMessage && (
        <button
          type="button"
          onClick={toggleFullscreen}
          className="sm:hidden absolute bottom-[4.5rem] right-3 z-20 flex items-center gap-2 pl-3.5 pr-4 py-3 rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-600 text-black text-xs font-extrabold shadow-2xl shadow-cyan-500/40 active:scale-95 transition"
          title="Enter fullscreen"
        >
          <Maximize className="w-4.5 h-4.5" />
          <span>Fullscreen</span>
        </button>
      )}

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/90 via-black/60 to-transparent z-10 transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          {/* Left Controls: Play, Volume, Live Badge */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={togglePlay}
              className="p-3 sm:p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white backdrop-blur-md transition transform active:scale-95"
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
            </button>

            {/* Volume — the slider is hidden on phones (hardware volume keys
                + iOS ignores programmatic volume); mute stays reachable. */}
            <div className="flex items-center gap-2 group/volume">
              <button
                onClick={toggleMute}
                className="p-2.5 sm:p-2 rounded-xl text-slate-300 hover:text-white transition"
                title="Mute (M)"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="hidden sm:block w-16 md:w-24 h-1.5 bg-white/20 accent-cyan-400 rounded-lg cursor-pointer"
              />
            </div>

            {/* Live Indicator */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 text-xs font-semibold border border-rose-500/30">
              <Radio className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              <span>LIVE BROADCAST</span>
            </div>
          </div>

          {/* Right Controls: Reload, Quality/Auto-bitrate, PiP, Fullscreen */}
          <div className="flex items-center gap-1.5 sm:gap-2 relative flex-shrink-0">
            {/* Reconnect / Reload */}
            <button
              onClick={() => loadStream(channel.url, useProxy)}
              className="p-2.5 sm:p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition"
              title="Reload Stream"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Quality & Auto-bitrate Selector */}
            {qualities.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowQualityMenu(!showQualityMenu)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition"
                  title="Stream Quality / Auto-Bitrate"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>
                    {currentQuality === -1
                      ? autoResolution
                        ? `Auto (${autoResolution})`
                        : "Auto"
                      : qualities[currentQuality]?.name || "Quality"}
                  </span>
                </button>

                {showQualityMenu && (
                  <div className="absolute bottom-10 right-0 w-36 py-2 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-2xl z-40">
                    <button
                      onClick={() => selectQuality(-1)}
                      className={`w-full text-left px-3 py-1.5 text-xs font-medium flex items-center justify-between transition ${
                        currentQuality === -1
                          ? "bg-cyan-500/20 text-cyan-300"
                          : "text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <span>Auto (Adaptive)</span>
                      {autoResolution && <span className="text-[10px] text-cyan-400">{autoResolution}</span>}
                    </button>
                    <div className="my-1 border-t border-slate-800" />
                    {qualities.map((lvl) => (
                      <button
                        key={lvl.id}
                        onClick={() => selectQuality(lvl.id)}
                        className={`w-full text-left px-3 py-1.5 text-xs font-medium transition ${
                          currentQuality === lvl.id
                            ? "bg-cyan-500/20 text-cyan-300"
                            : "text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        {lvl.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Picture in Picture — desktop/tablet only (no stable iPhone API) */}
            <button
              onClick={togglePiP}
              className="hidden sm:flex p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition"
              title="Picture-in-Picture"
            >
              <PictureInPicture className="w-4 h-4" />
            </button>

            {/* Fullscreen — larger touch target on mobile */}
            <button
              onClick={toggleFullscreen}
              className="flex items-center justify-center p-3 sm:p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition active:scale-95"
              title={isFullscreen ? "Exit Fullscreen (F)" : "Fullscreen (F)"}
            >
              {isFullscreen ? <Minimize className="w-6 h-6 sm:w-5 sm:h-5" /> : <Maximize className="w-6 h-6 sm:w-5 sm:h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
