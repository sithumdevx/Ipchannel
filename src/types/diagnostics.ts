/**
 * Shared shapes for the in-player diagnostics suite.
 *
 * Two independent verdicts are reported side by side and never conflated:
 *
 *  - **Connection quality** describes the *network* between the viewer and us.
 *    It is derived from the browser's Network Information API where available
 *    and always from a measured round-trip to our own origin. It is available
 *    before, during, and after playback.
 *   - **Stream state** describes what the *player* is doing with the media it
 *    already requested. A perfect connection can still hit a dead channel, and
 *    a dead-slow connection can still play back a 360p stream perfectly.
 *
 * Keeping them separate is the whole point: "Poor Connection" plus "Stream
 * Stable" is a coherent diagnosis, and collapsing the two into one badge would
 * lose exactly the information that makes this useful.
 */

/** How good the viewer's connection looks right now. */
export type ConnectionTier = "excellent" | "good" | "fair" | "poor" | "offline";

/** What the player is doing with the stream right now. */
export type StreamState = "idle" | "playing" | "buffering" | "paused" | "offline";

/** Which evidence the connection verdict was built from. */
export type ConnectionSource = "measured-latency" | "network-information" | "none";

export interface ConnectionQuality {
  tier: ConnectionTier;
  /** Short badge label, e.g. `"Excellent (Stable)"`. */
  label: string;
  /** One-line explanation of how the verdict was reached. */
  hint: string;
  /** Filled bars out of four for the signal meter. */
  bars: number;
  source: ConnectionSource;
}

/** A point-in-time read of the viewer's network, from any available source. */
export interface NetworkSnapshot {
  /** `navigator.onLine`. */
  online: boolean;
  /** Network Information API radio class: `"4g"`, `"3g"`, `"2g"`, `"slow-2g"`. */
  effectiveType: string | null;
  /** Network Information API downlink estimate, in Mbps. */
  downlinkMbps: number | null;
  /** Network Information API round-trip estimate, in ms. */
  rttMs: number | null;
  /** The browser reports the user asked to reduce data usage. */
  saveData: boolean;
  /** Rolling median round-trip to our own origin, in ms. */
  latencyMs: number | null;
  /** How many probes the median is built from. */
  latencySamples: number;
  /**
   * How many probes have finished, successful or not.
   *
   * Distinguishes "nothing has been measured yet" from "nothing can be
   * measured" — without it, a browser that lacks the Network Information API
   * and cannot reach the probe would look permanently like it is still
   * starting up.
   */
  probes: number;
}

/** Everything the player knows about the stream it is playing. */
export interface PlayerTelemetry {
  stream: StreamState;
  /** Rendering resolution label, e.g. `"720p"`. */
  resolution: string | null;
  /** True while adaptive bitrate — not a pinned level — is choosing quality. */
  auto: boolean;
  /** hls.js bandwidth estimate, in bits/s. */
  bandwidthBps: number | null;
  /** Seconds of media buffered ahead of the playhead. */
  bufferSeconds: number | null;
  /** Share of decoded frames dropped so far, 0–1. */
  droppedRatio: number | null;
  /** Automatic downward quality switches observed on this stream. */
  downgrades: number;
}

/**
 * The telemetry the widget shows before a stream has said anything.
 *
 * Also used as the server snapshot for `useSyncExternalStore`, so it must stay
 * deterministic — a value derived from `navigator` here would hydrate
 * differently on the client and warn.
 */
export const EMPTY_TELEMETRY: PlayerTelemetry = {
  stream: "idle",
  resolution: null,
  auto: true,
  bandwidthBps: null,
  bufferSeconds: null,
  droppedRatio: null,
  downgrades: 0,
};

/** The connection state shown before the first probe completes. */
export const UNKNOWN_NETWORK: NetworkSnapshot = {
  online: true,
  effectiveType: null,
  downlinkMbps: null,
  rttMs: null,
  saveData: false,
  latencyMs: null,
  latencySamples: 0,
  probes: 0,
};
