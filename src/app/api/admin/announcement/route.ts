import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  clearAnnouncement,
  getAnnouncement,
  normalizeAnnouncementInput,
  publishAnnouncement,
} from "@/lib/announcements";

/**
 * Broadcast banner control (admin only).
 *
 * Read the current banner, publish or replace it, or clear it. Validation lives
 * in `normalizeAnnouncementInput` so the same rules apply however the banner is
 * written, and it rejects anything that could turn a site-wide banner into an
 * open redirect.
 */


export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const announcement = await getAnnouncement();
  return NextResponse.json({ announcement }, { headers: { "Cache-Control": "no-store" } });
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

  try {
    const input = normalizeAnnouncementInput({
      message: body.message,
      level: body.level,
      detail: body.detail,
      href: body.href,
      expiresInMinutes: body.expiresInMinutes,
    });

    const announcement = await publishAnnouncement(input, gate.admin.email ?? gate.admin.id);

    return NextResponse.json(
      { ok: true, announcement },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not publish the announcement." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function DELETE() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const cleared = await clearAnnouncement();

  return NextResponse.json(
    { ok: true, cleared },
    { headers: { "Cache-Control": "no-store" } }
  );
}
