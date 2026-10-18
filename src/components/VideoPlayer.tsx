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
  AlertCircle,
  Radio,
  PictureInPicture,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { Channel } from "@/types/iptv";
import { countryFlag, countryLabel } from "@/lib/countries";
import { cleanChannelTitle } from "@/lib/channel-display";

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
  const [networkRetries, setNetworkRetries] = useState<number>(0);

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

  // Initialize and load HLS stream with optimized buffer & auto level switching
  const loadStream = useCallback(
    (streamUrl: string, proxyState: boolean) => {
      const video = videoRef.current;
      if (!video) return;

      setIsLoading(true);
      setErrorMessage(null);

      // Clean up previous HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const activeUrl = getStreamUrl(streamUrl, proxyState);

      if (Hls.isSupported()) {
        const hls = new Hls({
          // Optimized buffer settings to prevent stuttering and frequent buffering
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          maxBufferHole: 0.5,
          highBufferWatchdogPeriod: 2,
          // Timeouts & recovery
          manifestLoadingTimeOut: 20000,
          levelLoadingTimeOut: 20000,
          fragLoadingTimeOut: 30000,
          // Auto bitrate / quality scaling
          startLevel: -1, // Auto level switching enabled from start
          autoStartLoad: true,
          capLevelToPlayerSize: true, // Auto cap to player dimensions to conserve bandwidth
          abrEwmaDefaultEstimate: 1000000, // 1 Mbps default starting bandwidth estimate
        });

        hlsRef.current = hls;
        hls.attachMedia(video);

        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          hls.loadSource(activeUrl);
        });

        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          setIsLoading(false);
          setErrorMessage(null);
          setNetworkRetries(0);

          const levels = data.levels.map((lvl, index) => ({
            id: index,
            name: lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)}k`,
          }));
          setQualities(levels);

          video.play().catch(() => {
            setIsPlaying(false);
          });
        });

        // Track auto resolution switching dynamically
        hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
          if (data.level >= 0 && hls.levels[data.level]) {
            const lvl = hls.levels[data.level];
            setAutoResolution(lvl.height ? `${lvl.height}p` : "");
          }
        });


        hls.on(Hls.Events.ERROR, (_, data) => {
          console.warn("HLS Event Error:", data.type, data.details, data.fatal);

          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                // Auto-fallback to CORS proxy if direct failed and not already using proxy
                if (!proxyState) {
                  console.info("Direct playback network/CORS error. Auto-activating CORS proxy...");
                  setUseProxy(true);
                  loadStream(streamUrl, true);
                  return;
                }

                if (networkRetries < 2) {
                  setNetworkRetries((prev) => prev + 1);
                  hls.startLoad();
                } else {
                  setIsLoading(false);
                  setErrorMessage(
                    "Stream network error or geo-restricted. Try another channel or reconnect."
                  );
                  hls.destroy();
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.info("Recovering from media error...");
                hls.recoverMediaError();
                break;
              default:
                setIsLoading(false);
                setErrorMessage(
                  "Unable to decode stream format. Stream might be offline."
                );
                hls.destroy();
                break;
            }
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS support for Safari / iOS
        video.src = activeUrl;
        video.addEventListener("loadedmetadata", () => {
          setIsLoading(false);
          video.play().catch(() => setIsPlaying(false));
        });
        video.addEventListener("error", () => {
          if (!proxyState) {
            setUseProxy(true);
            loadStream(streamUrl, true);
          } else {
            setIsLoading(false);
            setErrorMessage("Failed to play HLS stream natively.");
          }
        });
      } else {
        setIsLoading(false);
        setErrorMessage("HLS playback is not supported in this browser.");
      }
    },
    [getStreamUrl, networkRetries]
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
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
      setCurrentQuality(levelIndex);
      setShowQualityMenu(false);
    }
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
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
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

      {/* Error Overlay */}
      {errorMessage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md z-30 p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4">
            <AlertCircle className="w-8 h-8 text-rose-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">Stream Unavailable</h3>
          <p className="text-sm text-slate-400 max-w-md mt-1 mb-6">{errorMessage}</p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => loadStream(channel.url, useProxy)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition shadow-lg shadow-cyan-600/30"
            >
              <RotateCw className="w-4 h-4" />
              Retry Stream
            </button>

            <button
              onClick={() => {
                const nextProxy = !useProxy;
                setUseProxy(nextProxy);
                loadStream(channel.url, nextProxy);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 transition"
            >
              {useProxy ? (
                <>
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  Try Direct Connection
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Try with CORS Proxy
                </>
              )}
            </button>

            {onNextChannel && (
              <button
                onClick={onNextChannel}
                className="px-4 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-sm font-medium border border-slate-700/60 transition"
              >
                Next Channel →
              </button>
            )}
          </div>
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
