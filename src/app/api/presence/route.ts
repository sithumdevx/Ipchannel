import { NextRequest, NextResponse } from "next/server";
import { getSessionIdentity } from "@/lib/admin";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { checkSameOrigin, getClientIp } from "@/lib/security/origin-guard";
import {
  dropSession,
  heartbeat,
  isSessionVerified,
  markSessionVerified,
  presenceSnapshot,
  type ChannelRef,
} from "@/lib/viewer-presence";

/**
 * Viewer presence heartbeat.
 *
 * The player posts here while it is mounted so the admin dashboard can report
 * "Active Live Viewers" and a most-watched leaderboard. There is no other
 * source for that data: watch history is browser-local and Supabase only stores
 * favorites.
 *
 * Design notes:
 *  - **Cheap by default.** Only the *first* heartbeat of a session performs a
 *    Supabase token validation; the result is cached in the presence registry
 *    for five minutes, so a viewer costs one Auth round-trip per five minutes
 *    rather than one per beat.
 *  - **Bounded.** A hard cap on tracked sessions and a per-IP rate limit mean a
 *    malicious caller can slow the counter down but cannot grow memory or
 *    inflate the number without an authenticated account.
 *  - **Never on the playback path.** Every failure is a soft failure: the
 *    client ignores a non-200 and playback is unaffected.
 */


const MAX_FIELD_LENGTH = { id: 96, name: 160, category: 80, country: 80 } as const;

/** Heartbeats are ~2/min per viewer; this is generous but still a bound. */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function parseChannel(raw: unknown): ChannelRef | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;

  const id = clean(source.id, MAX_FIELD_LENGTH.id);
  if (!id) return null;

  const name = clean(source.name, MAX_FIELD_LENGTH.name) || id;

  return {
    id,
    name,
    category: clean(source.category, MAX_FIELD_LENGTH.category),
    country: clean(source.country, MAX_FIELD_LENGTH.country),
  };
}

export async function POST(request: NextRequest) {
  const origin = checkSameOrigin(request);
  if (!origin.ok) {
    return NextResponse.json(
      { error: "Cross-origin request rejected." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const limit = checkRateLimit(`presence:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many heartbeats." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(limit.resetInSeconds),
        },
      }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json(
      { error: "Invalid session id." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Explicit leave (tab close / navigation away) so concurrency drops at once
  // instead of waiting out the presence window.
  if (body.leave === true) {
    dropSession(sessionId);
    const snapshot = presenceSnapshot();
    return NextResponse.json(
      { viewers: snapshot.active, peak: snapshot.peak },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const channel = parseChannel(body.channel);

  // Only the first heartbeat of a session (per five-minute window) pays for a
  // Supabase token validation; the verdict is cached in the presence registry.
  // Repeat beats skip the Auth round-trip entirely.
  if (!isSessionVerified(sessionId)) {
    const identity = await getSessionIdentity();
    if (!identity) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    markSessionVerified(sessionId);
  }

  heartbeat(sessionId, channel);

  const summary = presenceSnapshot();

  return NextResponse.json(
    { viewers: summary.active, peak: summary.peak },
    { headers: { "Cache-Control": "no-store" } }
  );
}
