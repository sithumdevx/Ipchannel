import { NextResponse } from "next/server";
import { connection } from "next/server";
import { adminConfigured, getSessionIdentity, isAdminEmail } from "@/lib/admin";

/**
 * Is the caller an administrator?
 *
 * A deliberately tiny endpoint used by the header navbar to decide whether to
 * render the Dashboard link. It answers with a boolean and nothing sensitive —
 * it never reveals the allowlist, and the *authoritative* check still happens
 * on every request to `/api/admin/stats` and on the `/admin` page itself.
 * Treating this as a UI hint, not as a security boundary, is what keeps admin
 * checks in one place.
 */


export async function GET() {
  // Must stay request-time: the allowlist is read from the environment, and a
  // prerender always runs with it unset (see the note on `/admin`). Without
  // `connection()` the "not configured" answer would be baked into a static
  // response and the nav link would never appear.
  await connection();

  const configured = adminConfigured();

  let email: string | null = null;
  let admin = false;

  if (configured) {
    const identity = await getSessionIdentity();
    email = identity?.email ?? null;
    admin = isAdminEmail(email);
  }

  return NextResponse.json(
    { admin, email: admin ? email : null, configured },
    { headers: { "Cache-Control": "no-store" } }
  );
}
