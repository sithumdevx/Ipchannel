import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { collectAdminStats } from "@/lib/admin-stats";
import { clearCatalogCache, getChannelCatalog } from "@/lib/channels";
import { clearSegmentCache } from "@/lib/segment-cache";
import { resetHealth, scanCatalog, sweepWatchSet } from "@/lib/stream-health";
import { resetMetrics } from "@/lib/metrics";
import type { AdminAction, AdminActionResponse } from "@/types/admin";

/**
 * Admin maintenance actions.
 *
 * One endpoint rather than five, because every action shares the same three
 * requirements: an admin check, a bounded runtime, and a refreshed snapshot so
 * the console reflects the result immediately instead of a stale frame.
 *
 * Actions are dispatched from an explicit allow-list — the request body cannot
 * name an arbitrary function — and each one reports what it actually did in
 * `summary`/`detail`, including when it had to stop early.
 */


/** Headroom for the inline scan actions. */
export const maxDuration = 60;

/** Targets per scan. The full sweep is deliberately slower but still bounded. */
const QUICK_SCAN = { limit: 400, budgetMs: 25_000 };
const FULL_SCAN = { limit: 1_500, budgetMs: 45_000 };

const VALID_ACTIONS: AdminAction[] = [
  "health-check",
  "deep-health-check",
  "refresh-cache",
  "clear-caches",
  "flush-states",
];

function parseAction(value: unknown): AdminAction | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().toLowerCase();
  return (VALID_ACTIONS as string[]).includes(normalised) ? (normalised as AdminAction) : null;
}

/**
 * Re-probe a batch of streams inline.
 *
 * `full` widens the budget for the "re-check everything" variant; either way the
 * probe stops at its deadline and says so (`timedOut`), because no serverless
 * function may outlive its ceiling.
 */
async function runHealthCheck(full: boolean) {
  const catalog = await getChannelCatalog();
  const budget = full ? FULL_SCAN : QUICK_SCAN;

  const scan = await scanCatalog(catalog.channels, budget);

  // Sweep anything else we have already served, behind the response.
  void sweepWatchSet().catch(() => undefined);

  return {
    summary:
      scan.checked === 0
        ? "Every stream already has a fresh verdict — nothing to re-check."
        : `${scan.checked} streams probed, ${scan.dead} confirmed offline${
            scan.timedOut ? " (probe budget reached)" : ""
          }.`,
    detail: { ...scan, mode: full ? "full" : "quick" },
  };
}

async function runRefreshCache() {
  const before = await getChannelCatalog();
  const result = await clearCatalogCache();

  return {
    summary: `Catalogue cache dropped (${result.dropped} channels${
      before.source === "fallback" ? ", was serving the bootstrap list" : ""
    }) and a fresh download started.`,
    detail: { ...result, previousSource: before.source },
  };
}

async function runClearCaches() {
  const catalog = await clearCatalogCache();
  const segments = clearSegmentCache();

  return {
    summary: `Catalogue cache (${catalog.dropped} channels) and segment cache (${segments.cleared} chunks, ${Math.round(
      segments.bytes / 1024
    )} KB) cleared; download restarted.`,
    detail: { catalogue: catalog, segments },
  };
}

async function runFlushStates() {
  const health = resetHealth();
  const segments = clearSegmentCache();
  const catalog = await clearCatalogCache();
  resetMetrics();

  return {
    summary: `Flushed ${health.cleared} health verdicts, ${segments.cleared} cached segments, and all counters. Streams will be re-probed on demand.`,
    detail: { health, segments, catalogue: catalog },
  };
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const action = parseAction(body.action);
  if (!action) {
    return NextResponse.json(
      { error: `Unknown action. Expected one of: ${VALID_ACTIONS.join(", ")}.` },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const startedAt = Date.now();

  try {
    const result =
      action === "health-check"
        ? await runHealthCheck(false)
        : action === "deep-health-check"
          ? await runHealthCheck(true)
          : action === "refresh-cache"
            ? await runRefreshCache()
            : action === "clear-caches"
              ? await runClearCaches()
              : await runFlushStates();

    const stats = await collectAdminStats();

    const payload: AdminActionResponse = {
      ok: true,
      action,
      summary: result.summary,
      detail: { ...result.detail, durationMs: Date.now() - startedAt },
      stats,
    };

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Action failed.",
        action,
        detail: error instanceof Error ? error.message : "unknown",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
