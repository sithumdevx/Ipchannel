import { NextRequest, NextResponse } from "next/server";
import { FALLBACK_CHANNELS } from "@/lib/m3u-parser";
import {
  ensureHealthSweeper,
  healthSummary,
  sweepWatchSet,
  verifyNow,
} from "@/lib/stream-health";

/**
 * Stream-health endpoint.
 *
 * Two jobs:
 *
 *  1. Cron trigger — `vercel.json` hits `/api/health` every 5 minutes. The
 *     handler runs a sweep of the watch set, which is how streams get
 *     re-verified on serverless platforms where background timers don't
 *     persist. Protected by `HEALTH_CRON_SECRET` when set (Vercel sends
 *     `Authorization: Bearer <secret>` for cron jobs).
 *
 *  2. Status/verification — `?check=<url>` probes a single stream on demand
 *     and returns its health; a plain GET returns aggregate counters. This is
 *     what the client polls to keep the LIVE badges current.
 */

function cronAuthorized(request: NextRequest): boolean {
  const secret = process.env.HEALTH_CRON_SECRET;
  if (!secret) return true; // no secret configured — allow (dev / self-host)

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (request.nextUrl.searchParams.get("secret") === secret) return true;
  return false;
}

export async function GET(request: NextRequest) {
  ensureHealthSweeper();

  // Background sweep — driven by the 5-minute cron schedule.
  if (request.nextUrl.searchParams.has("sweep")) {
    if (!cronAuthorized(request)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const result = await sweepWatchSet();
    return NextResponse.json(
      {
        ...result,
        ...healthSummary(),
        sweptAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // On-demand probe of a single stream. Used by the LIVE badge refresh and by
  // the player, which reports a stream it could not play with `force=1` so a
  // genuinely dead endpoint is marked offline without waiting for its TTL.
  const checkUrl = request.nextUrl.searchParams.get("check");
  if (checkUrl) {
    let parsed: URL;
    try {
      parsed = new URL(checkUrl);
    } catch {
      return NextResponse.json(
        { error: "Invalid URL" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json(
        { error: "Only http(s) URLs can be checked" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const force = request.nextUrl.searchParams.get("force") === "1";
    const results = await verifyNow(
      [{ ...FALLBACK_CHANNELS[0], url: parsed.toString() }],
      1,
      { force }
    );
    const status = results.get(parsed.toString());

    return NextResponse.json(
      { url: parsed.toString(), status: status ?? "unknown" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // Aggregate counters for dashboards/debugging.
  return NextResponse.json(
    { ...healthSummary(), now: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
