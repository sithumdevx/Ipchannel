"use client";

import { type ComponentType, type ReactNode, useSyncExternalStore } from "react";
import {
  CircleCheck,
  CircleDot,
  CircleX,
  Gauge,
  LoaderCircle,
  Pause,
  SignalHigh,
  SignalLow,
  SignalMedium,
  SignalZero,
  TrendingDown,
  WifiOff,
  Zap,
} from "lucide-react";
import { formatBandwidth, formatLatency } from "@/lib/network-quality";
import { useConnectionQuality } from "@/hooks/useConnectionQuality";
import {
  getServerTelemetry,
  getTelemetry,
  subscribeTelemetry,
} from "@/lib/player-telemetry";
import type { ConnectionTier, StreamState } from "@/types/diagnostics";

/**
 * Sri Lanka Network Friendly — the diagnostics widget for the "Now Playing"
 * panel.
 *
 * Two independent readings, because they answer two different questions:
 *
 *  - **Connection** — how good is the link *right now*? Sourced from the
 *    Network Information API and a real round trip to our own origin, so it is
 *    meaningful even while the stream is stalled.
 *  - **Stream** — what is the player actually doing? Pulled live from
 *    `hls.js` and the `<video>` element via the telemetry store, so it
 *    distinguishes "your network is bad" from "this channel is down".
 *
 * The badge copy deliberately under-promises (see `classifyConnection`): a
 * diagnostics panel that says "Excellent" through a stall is worse than none.
 */

type IconComponent = ComponentType<{ className?: string }>;

interface ConnectionStyle {
  Icon: IconComponent;
  /** Badge classes. */
  badge: string;
  /** Filled signal-bar colour. */
  bar: string;
}

const CONNECTION_STYLES: Record<ConnectionTier, ConnectionStyle> = {
  excellent: {
    Icon: SignalHigh,
    badge:
      "bg-emerald-500/15 border-emerald-400/40 text-emerald-700 dark:text-emerald-300",
    bar: "bg-emerald-400",
  },
  good: {
    Icon: SignalMedium,
    badge: "bg-cyan-500/15 border-cyan-400/40 text-cyan-700 dark:text-cyan-200",
    bar: "bg-cyan-400",
  },
  fair: {
    Icon: SignalLow,
    badge: "bg-amber-500/15 border-amber-400/40 text-amber-700 dark:text-amber-300",
    bar: "bg-amber-400",
  },
  poor: {
    Icon: SignalZero,
    badge: "bg-rose-500/15 border-rose-400/40 text-rose-700 dark:text-rose-300",
    bar: "bg-rose-400",
  },
  offline: {
    Icon: WifiOff,
    badge: "bg-slate-500/15 border-slate-400/40 text-slate-600 dark:text-slate-300",
    bar: "bg-slate-500",
  },
};

interface StreamStyle {
  Icon: IconComponent;
  label: string;
  badge: string;
  /** Spin the icon — only while buffering. */
  spin: boolean;
}

const STREAM_STYLES: Record<StreamState, StreamStyle> = {
  playing: {
    label: "Stream Stable",
    Icon: CircleCheck,
    badge:
      "bg-emerald-500/15 border-emerald-400/40 text-emerald-700 dark:text-emerald-300",
    spin: false,
  },
  buffering: {
    label: "Buffering",
    Icon: LoaderCircle,
    badge: "bg-amber-500/15 border-amber-400/40 text-amber-700 dark:text-amber-300",
    spin: true,
  },
  offline: {
    label: "Stream Offline",
    Icon: CircleX,
    badge: "bg-rose-500/15 border-rose-400/40 text-rose-700 dark:text-rose-300",
    spin: false,
  },
  paused: {
    label: "Paused",
    Icon: Pause,
    badge: "bg-glass2 border-line2 text-dim",
    spin: false,
  },
  idle: {
    label: "Connecting",
    Icon: CircleDot,
    badge: "bg-glass2 border-line2 text-dim",
    spin: false,
  },
};

/** Four ascending bars; `filled` of them are lit. */
function SignalBars({ filled, barClass }: { filled: number; barClass: string }) {
  return (
    <span className="flex items-end gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{ height: `${5 + i * 3}px` }}
          className={`w-[3px] rounded-full transition-colors ${
            i < filled ? barClass : "bg-dim/25"
          }`}
        />
      ))}
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-chip border border-line px-2 py-[3px] text-[10px] font-semibold text-dim">
      {children}
    </span>
  );
}

export default function PlayerDiagnostics() {
  const { quality, snapshot } = useConnectionQuality();
  const telemetry = useSyncExternalStore(
    subscribeTelemetry,
    getTelemetry,
    getServerTelemetry
  );

  // Nothing has reported in yet: no probe has finished and the browser has no
  // usable hint either. Once a probe settles — even by failing — the widget
  // switches to a real verdict instead of spinning forever.
  const checking =
    snapshot.probes === 0 &&
    snapshot.effectiveType === null &&
    snapshot.downlinkMbps === null &&
    snapshot.rttMs === null;

  const connection = CONNECTION_STYLES[quality.tier];
  const stream = STREAM_STYLES[telemetry.stream];
  const StreamIcon = stream.Icon;

  // A dropped-frame ratio north of ~5% is the point at which viewers notice
  // juddering rather than a clean picture.
  const juddering = telemetry.droppedRatio !== null && telemetry.droppedRatio > 0.05;

  return (
    <div className="rounded-2xl border border-line2 bg-glass p-3.5 space-y-3 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-dim">
          <Gauge className="w-3.5 h-3.5 text-cyan-400" />
          Connection Diagnostics
        </span>
        <span className="relative flex h-1.5 w-1.5" title="Updates live">
          <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-400/60 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />
        </span>
      </div>

      {/* Connection quality */}
      <div className="space-y-2">
        {checking ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line2 bg-glass2 px-2.5 py-1 text-[11px] font-bold text-dim">
            <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
            Checking connection…
          </span>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${connection.badge}`}
            >
              <connection.Icon className="w-3.5 h-3.5" />
              {quality.label}
            </span>
            <span className="text-[11px] font-mono font-semibold text-ink tabular-nums">
              {formatLatency(snapshot.latencyMs)}
            </span>
          </div>
        )}

        {!checking && (
          <div className="flex items-center justify-between gap-2">
            <SignalBars filled={quality.bars} barClass={connection.bar} />
            <span className="text-[10px] text-faint truncate" title={quality.hint}>
              {quality.hint}
            </span>
          </div>
        )}

        {snapshot.saveData && (
          <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
            Data saver is on — quality is capped to save data.
          </p>
        )}
      </div>

      {/* Stream health */}
      <div className="pt-3 border-t border-line space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${stream.badge}`}
          >
            <StreamIcon className={`w-3.5 h-3.5 ${stream.spin ? "animate-spin" : ""}`} />
            {stream.label}
          </span>
          <span className="flex items-center gap-1.5">
            {telemetry.resolution && <Chip>{telemetry.resolution}</Chip>}
            {telemetry.bufferSeconds !== null && telemetry.stream !== "offline" && (
              <Chip>{Math.max(0, Math.floor(telemetry.bufferSeconds))}s buffer</Chip>
            )}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 text-[10px] font-medium text-faint">
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            {telemetry.auto ? "Adaptive bitrate" : "Quality pinned"}
            {telemetry.downgrades > 0 && (
              <span className="flex items-center gap-0.5 text-amber-500">
                <TrendingDown className="w-3 h-3" />
                {telemetry.downgrades} step{telemetry.downgrades === 1 ? "" : "s"} down
              </span>
            )}
          </span>
          {telemetry.bandwidthBps !== null && (
            <span>{formatBandwidth(telemetry.bandwidthBps)} link</span>
          )}
        </div>

        {juddering && (
          <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
            Dropping frames — try a lower quality if the picture stutters.
          </p>
        )}

        {telemetry.stream === "offline" && (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-rose-500">
            <WifiOff className="w-3 h-3" />
            This channel stopped responding. The player is trying to recover.
          </p>
        )}
      </div>
    </div>
  );
}
