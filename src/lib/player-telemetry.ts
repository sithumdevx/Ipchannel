/**
 * A tiny external store for player telemetry.
 *
 * Why not React state? The diagnostics widget lives in the "Now Playing" panel
 * while the facts it reports — buffer depth, chosen level, bandwidth estimate —
 * are only knowable inside `<VideoPlayer>`. Lifting them into the watch page
 * would re-render the whole channel grid (hundreds of cards) every couple of
 * seconds just to refresh a badge.
 *
 * `useSyncExternalStore` lets the widget subscribe on its own, so a telemetry
 * update re-renders exactly one component. The store is module-scoped because
 * exactly one player is ever mounted at a time; `resetTelemetry` clears it when
 * the player tears down so a later visit never shows stale numbers.
 */

import { EMPTY_TELEMETRY, type PlayerTelemetry } from "@/types/diagnostics";

let current: PlayerTelemetry = EMPTY_TELEMETRY;
const listeners = new Set<() => void>();

/** Shallow compare — every field is a primitive. */
function isSame(a: PlayerTelemetry, b: PlayerTelemetry): boolean {
  return (
    a.stream === b.stream &&
    a.resolution === b.resolution &&
    a.auto === b.auto &&
    a.bandwidthBps === b.bandwidthBps &&
    a.bufferSeconds === b.bufferSeconds &&
    a.droppedRatio === b.droppedRatio &&
    a.downgrades === b.downgrades
  );
}

/**
 * Publish a new snapshot.
 *
 * No-ops when nothing changed, which is what keeps the steady state (playing,
 * full buffer) from firing a re-render on every sampling tick.
 */
export function publishTelemetry(next: PlayerTelemetry): void {
  if (isSame(current, next)) return;
  current = next;
  for (const listener of listeners) listener();
}

/** Current snapshot. Must be referentially stable while unchanged. */
export function getTelemetry(): PlayerTelemetry {
  return current;
}

/** Hydration snapshot — always the neutral default, never a real reading. */
export function getServerTelemetry(): PlayerTelemetry {
  return EMPTY_TELEMETRY;
}

export function subscribeTelemetry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drop back to the idle snapshot (player unmounted / new stream loading). */
export function resetTelemetry(): void {
  publishTelemetry(EMPTY_TELEMETRY);
}
