import { NextResponse, connection } from "next/server";
import { resolveAdminAccess } from "@/lib/admin";

/**
 * Is the caller an administrator?
 *
 * A deliberately tiny endpoint used by the header navbar to decide whether to
 * render the Dashboard link. It answers with a boolean and nothing sensitive —
 * the *authoritative* check still happens on every request to `/api/admin/stats`
 * and on the `/admin` page itself. Treating this as a UI hint, not a security
 * boundary, is what keeps admin checks in one place.
 */


export async function GET() {
  // Must stay request-time: the answer depends on the request's cookies, and a
  // prerender has none. Without `connection()` the anonymous answer would be
  // baked into a static response and the nav link would never appear.
  await connection();

  const access = await resolveAdminAccess();

  return NextResponse.json(
    { admin: access.admin, email: access.admin ? access.identity?.email ?? null : null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
