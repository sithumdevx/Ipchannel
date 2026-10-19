import type { Metadata } from "next";
import { connection } from "next/server";
import { authBackendConfigured, resolveAdminAccess } from "@/lib/admin";
import AdminConsole from "./AdminConsole";
import AccessDenied from "./AccessDenied";

/**
 * Admin console (`/admin`).
 *
 * Access is decided *here*, on the server, before a single line of console
 * markup is rendered: the visitor's session cookie is validated against
 * Supabase (`auth.getUser()` — the token is verified with the Auth server, not
 * merely decoded), and the `role` on that account's `public.profiles` row is
 * what decides.
 *
 * That lookup runs with the caller's *own* credentials, so row-level security —
 * not this function — is what limits it to their own row, and `authenticated`
 * holds no write privilege on the table, so `admin` cannot be granted from a
 * client. The `/api/admin/*` routes re-run the same check independently, so even
 * bypassing this page reaches nothing.
 *
 * A refusal renders an explanatory 403 page rather than redirecting: someone who
 * followed an old bookmark should be told what happened, not quietly bounced.
 */

export const metadata: Metadata = {
  title: "Admin Console — StreamPulse",
  description: "Internal system health, stream diagnostics and analytics.",
  robots: { index: false, follow: false },
};

/**
 * Opt this route out of static prerendering.
 *
 * The answer depends on the request's session cookie, and a prerender always
 * runs with none — which would bake "not an administrator" into a static
 * response and lock every administrator out. `instant = false` is the supported
 * way to allow a blocking route (it is the Cache Components replacement for the
 * old `dynamic = "force-dynamic"`).
 */
export const instant = false;

export default async function AdminPage() {
  // Must stay request-time: the answer depends on the request's cookies, and a
  // prerender has none. Without `connection()` the anonymous answer would be
  // baked into a static response and no administrator could ever get in.
  await connection();

  const access = await resolveAdminAccess();

  if (access.admin && access.identity) {
    return <AdminConsole adminName={access.identity.name} adminId={access.identity.id} />;
  }

  return (
    <AccessDenied
      signedIn={Boolean(access.identity)}
      email={access.identity?.email ?? null}
      authAvailable={authBackendConfigured()}
      lookupError={access.error}
    />
  );
}
