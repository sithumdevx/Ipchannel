/**
 * Server startup hook (`instrumentation.ts`).
 *
 * A serverless instance boots empty. Kicking the live playlist download off here
 * means the first visitor usually finds the full catalogue — or its on-disk
 * snapshot from the previous instance — already in memory, instead of being
 * served the built-in bootstrap list while the playlist downloads.
 *
 * `register` gates server readiness, so the warm-up is deliberately *not*
 * awaited: booting must never wait on a third-party origin. Whatever is still
 * downloading keeps going in the background.
 */
export function register(): void {
  // This hook runs on every runtime, but the catalogue needs node:fs.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Don't reach out to the network from the build process.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  void (async () => {
    try {
      const { warmCatalog } = await import("./lib/channels");
      await warmCatalog();
    } catch (error) {
      // Warm-up is an optimisation; requests warm the catalogue themselves.
      console.warn("[channels] startup warm-up failed:", error);
    }
  })();
}
