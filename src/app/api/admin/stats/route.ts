import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { collectAdminStats } from "@/lib/admin-stats";

/**
 * Admin analytics + system health snapshot.
 *
 * Read-only: every mutation (scans, cache clears, moderation, broadcasts) lives
 * in its own endpoint so this one can be polled aggressively by the console
 * without any risk of a GET accidentally changing state.
 *
 * Access is enforced here rather than in the UI. `requireAdmin()` validates the
 * session token against Supabase and reads the account's `role` from
 * `public.profiles`, so the route is safe even if the dashboard page were
 * bypassed entirely.
 *
 * Nothing here is cacheable — every response is `no-store`, because a cached
 * analytics blob served to the wrong session would be a leak.
 */


export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  try {
    const stats = await collectAdminStats();
    return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to collect statistics.",
        detail: error instanceof Error ? error.message : "unknown",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
