import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side admin authorization.
 *
 * Everything under `/admin` and `/api/admin/*` is gated on an explicit
 * allowlist of email addresses (`ADMIN_EMAILS`, comma-separated). The *only*
 * trusted input is the Supabase access token carried in the request cookies:
 * it is validated against the Supabase Auth server (`auth.getUser()`) and the
 * email on the resulting user record is what gets checked against the
 * allowlist. Nothing client-supplied — no header, no body field, no local
 * storage — can grant admin access.
 *
 * With no allowlist configured there are deliberately *no* admins. The
 * dashboard then renders instructions for configuring one instead of quietly
 * opening itself to every signed-in account.
 */

export interface SessionIdentity {
  id: string;
  email: string | null;
  name: string;
  avatarUrl?: string;
}

/** Read + normalise `ADMIN_EMAILS` (comma-separated, case-insensitive). */
export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return [];

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.includes("@"))
    )
  );
}

/** True when at least one admin account is configured. */
export function adminConfigured(): boolean {
  return adminEmails().length > 0;
}

/** Case-insensitive allowlist check. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

/** Supabase credentials used for server-side session validation. */
function serverCredentials(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/**
 * Resolve the caller's identity from the Supabase session cookie.
 *
 * Returns `null` for anonymous callers, when Supabase is not configured, or
 * when the token fails server-side validation. `getUser()` is intentionally
 * used over `getSession()`: the former verifies the token with Supabase, the
 * latter only decodes what the (client-writable) cookie claims.
 */
export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const credentials = serverCredentials();
  if (!credentials) return null;

  let supabase;
  try {
    const cookieStore = await cookies();
    supabase = createServerClient(credentials.url, credentials.key, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components cannot mutate cookies. The refresh is a no-op
            // here; the session is still readable for this request.
          }
        },
      },
    });
  } catch {
    return null;
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) return null;

    const meta = user.user_metadata ?? {};
    const name =
      meta.display_name ||
      meta.username ||
      meta.full_name ||
      meta.name ||
      user.email?.split("@")[0] ||
      "User";

    return {
      id: user.id,
      email: user.email ?? null,
      name,
      avatarUrl: meta.avatar_url || meta.picture || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Identity of the caller *only* when they are on the admin allowlist.
 * `null` means "not an admin" — never distinguish "not signed in" here, so the
 * caller cannot probe whether an email is a known admin account.
 */
export async function getAdminIdentity(): Promise<SessionIdentity | null> {
  const identity = await getSessionIdentity();
  if (!identity || !isAdminEmail(identity.email)) return null;
  return identity;
}

/**
 * JSON guard for admin API routes.
 *
 * Returns a `403` response for non-admins so a route can bail out early:
 *
 *   const denied = await requireAdmin();
 *   if (denied) return denied;
 */
export async function requireAdmin(): Promise<
  { ok: true; admin: SessionIdentity } | { ok: false; response: Response }
> {
  const admin = await getSessionIdentity();

  if (!admin) {
    return {
      ok: false,
      response: Response.json(
        { error: "Authentication required." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }

  if (!isAdminEmail(admin.email)) {
    return {
      ok: false,
      response: Response.json(
        { error: "Administrator access required." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }

  return { ok: true, admin };
}
