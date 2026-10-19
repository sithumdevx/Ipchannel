import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRole, PROFILES_TABLE, type UserRole } from "@/lib/user-role";

/**
 * Server-side authorization.
 *
 * Console access is a row in `public.profiles` whose `role` is `admin`, and
 * nothing else. The only trusted input is the Supabase access token carried in
 * the request cookies: it is validated against the Supabase Auth server
 * (`auth.getUser()` — the token is *verified*, not merely decoded), and the
 * `role` on that account's profile row is what decides. Nothing client-supplied
 * — no header, no body field, no local storage — can grant access.
 *
 * The role is read with the *caller's own* credentials, so row-level security
 * does the filtering. The migration gives `authenticated` a single SELECT policy
 * matching `auth.uid() = id` and no write privilege at all, which means a member
 * can neither read somebody else's row nor promote themselves — the console's
 * promote/demote goes through the service role instead.
 *
 * Everything here fails closed. A missing row, an unreadable table, a missing
 * Supabase configuration — each of them means "not an administrator", never the
 * opposite. `error` exists so the console can tell an operator *why* it could
 * not answer (usually: the migration has not been applied), not so the answer
 * can be loosened.
 */

export interface SessionIdentity {
  id: string;
  email: string | null;
  name: string;
  avatarUrl?: string;
}

/**
 * The result of resolving who is calling and what they may do.
 *
 * `error` distinguishes "this account is not an administrator" from "the
 * question could not be answered", which is what lets the 403 page explain a
 * missing migration instead of dead-ending. It is only ever surfaced to a
 * signed-in caller.
 */
export interface AdminAccess {
  identity: SessionIdentity | null;
  /** The role on the account's profile row; `null` when the row was unreadable. */
  role: UserRole | null;
  admin: boolean;
  /** Why the role could not be read — `null` when the lookup ran. */
  error: string | null;
}

const ANONYMOUS: AdminAccess = { identity: null, role: null, admin: false, error: null };

/** Supabase credentials used for server-side session validation. */
function serverCredentials(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/**
 * True when this server holds the credentials it needs to authenticate at all.
 *
 * Exposed so a page can tell "you are not allowed in" apart from "nobody can
 * sign in yet", without duplicating the environment check.
 */
export function authBackendConfigured(): boolean {
  return serverCredentials() !== null;
}

/**
 * A Supabase client bound to the caller's cookies, or `null` when Supabase is
 * not configured. The client is deliberately created per call: a server
 * component, a route handler, and a proxy do not share a request scope, and the
 * cost of construction is trivial next to the network call it precedes.
 */
async function sessionClient(): Promise<SupabaseClient | null> {
  const credentials = serverCredentials();
  if (!credentials) return null;

  try {
    const cookieStore = await cookies();
    return createServerClient(credentials.url, credentials.key, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Called when Supabase rotates the access token. Server Components
          // cannot write cookies, so a rotation here is dropped and the browser
          // persists the refreshed token on its next request instead.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Read-only cookie store — nothing to do.
          }
        },
      },
    });
  } catch {
    return null;
  }
}

/** Validate the session cookie with the Auth server and map it to an identity. */
async function readIdentity(supabase: SupabaseClient): Promise<SessionIdentity | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    const user = data.user;
    const meta = user.user_metadata ?? {};
    const name =
      meta.display_name ||
      meta.username ||
      meta.full_name ||
      meta.name ||
      user.email?.split("@")[0] ||
      "User";

    const avatar = meta.avatar_url || meta.picture || undefined;

    return {
      id: user.id,
      email: user.email ?? null,
      name,
      avatarUrl: typeof avatar === "string" ? avatar : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Read one account's role.
 *
 * Only ever called with the *caller's own* id, so the RLS policy is the
 * authority on whether the row may be seen. A missing row is not an error — the
 * overwhelming majority of accounts never get one written, and `user` is the
 * correct reading of "no role granted".
 */
async function readRole(
  supabase: SupabaseClient,
  userId: string
): Promise<{ role: UserRole | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from(PROFILES_TABLE)
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      return {
        role: null,
        error: `Could not read public.${PROFILES_TABLE}: ${error.message}`,
      };
    }

    return { role: normalizeRole((data as { role?: unknown } | null)?.role), error: null };
  } catch (cause) {
    return {
      role: null,
      error: cause instanceof Error ? cause.message : "The role lookup failed.",
    };
  }
}

/**
 * Who is calling, and whether that means console access — in a single pass.
 *
 * One cookie read and at most one extra query, so a page and a route handler
 * cannot end up asking two subtly different questions.
 */
export async function resolveAdminAccess(): Promise<AdminAccess> {
  const supabase = await sessionClient();
  if (!supabase) {
    return {
      ...ANONYMOUS,
      error:
        "Supabase is not configured on the server (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    };
  }

  const identity = await readIdentity(supabase);
  if (!identity) return ANONYMOUS;

  const { role, error } = await readRole(supabase, identity.id);
  return { identity, role, admin: role === "admin", error };
}

/**
 * The caller's identity from the Supabase session cookie, or `null`.
 *
 * `null` covers every unauthenticated case at once — no cookie, an expired or
 * forged token, Supabase unconfigured — deliberately, so callers cannot tell
 * them apart.
 */
export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const supabase = await sessionClient();
  return supabase ? readIdentity(supabase) : null;
}

/**
 * JSON guard for admin API routes.
 *
 * Returns a `401`/`403` response for anyone who is not an administrator, so a
 * route can bail out before it reads the body:
 *
 *   const gate = await requireAdmin();
 *   if (!gate.ok) return gate.response;
 */
export async function requireAdmin(): Promise<
  { ok: true; admin: SessionIdentity } | { ok: false; response: Response }
> {
  const access = await resolveAdminAccess();

  if (!access.identity) {
    return {
      ok: false,
      response: Response.json(
        { error: "Authentication required." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }

  if (!access.admin) {
    return {
      ok: false,
      response: Response.json(
        { error: "Administrator access required." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }

  return { ok: true, admin: access.identity };
}
