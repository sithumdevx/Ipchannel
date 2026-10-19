import { NextResponse } from "next/server";
import { getAnnouncement, isAnnouncementLive } from "@/lib/announcements";

/**
 * Public broadcast banner feed.
 *
 * Deliberately unauthenticated: the banner has to reach signed-out visitors too
 * (a maintenance notice is useless if it only shows after sign-in). It exposes
 * nothing but the operator-authored message, and it is `no-store` so a cleared
 * banner disappears on the next poll rather than lingering in a cache.
 *
 * `Cache-Control: no-store` plus a short client poll interval is what makes
 * "publish instantly" true without a websocket layer.
 */


export async function GET() {
  try {
    const announcement = await getAnnouncement();

    if (!isAnnouncementLive(announcement)) {
      return NextResponse.json({ active: false }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json(
      {
        active: true,
        announcement: {
          id: announcement!.id,
          message: announcement!.message,
          level: announcement!.level,
          detail: announcement!.detail,
          href: announcement!.href,
          publishedAt: announcement!.publishedAt,
          expiresAt: announcement!.expiresAt,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    // A broken store must never surface as an error to every visitor.
    return NextResponse.json({ active: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
