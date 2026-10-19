import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { landingPathForRole, normalizeRole, PROFILES_TABLE, type UserRole } from "@/lib/user-role";

/**
 * Open-redirect protection.
 *
 * `next` comes straight from the OAuth redirect URL, so an attacker could
 * craft `?next=//evil.com` (or an encoded/whitespace variant) and bounce a
 * freshly authenticated victim to an arbitrary site. Only accept a relative,
 * single-slash, traversal-free path inside this deployment; anything else
 * falls back to `/watch`.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function sanitizeNext(next: string | null): string {
  const FALLBACK = "/watch";
  if (!next) return FALLBACK;
  if (next.length > 512) return FALLBACK;
  if (CONTROL_CHARS.test(next)) return FALLBACK;
  if (!next.startsWith("/")) return FALLBACK;
  if (next.startsWith("//") || next.startsWith("/\\")) return FALLBACK;

  let decoded = next;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return FALLBACK;
  }
  if (decoded.includes("..")) return FALLBACK;
  if (CONTROL_CHARS.test(decoded)) return FALLBACK;
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.startsWith("/\\")) {
    return FALLBACK;
  }
  return decoded;
}

/**
 * Resolve the public origin the request was reached on.
 *
 * Deployment hosts (Vercel edge, previews, custom domains) can present an
 * internal URL to the runtime, so trust the forwarded headers first:
 * `x-forwarded-proto` + `x-forwarded-host`/`host`, then fall back to the
 * request URL's own origin for local development.
 */
function resolveOrigin(request: NextRequest): string {
  const forwardedHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host")?.split(",")[0]?.trim();
  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    request.nextUrl.protocol.replace(":", "");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

/**
 * Landing targets that carry no intent of their own — a bare "take me to the
 * app". The account's role decides these, not the query string.
 */
const GENERIC_TARGETS = new Set(["/watch", "/"]);

/**
 * Where a freshly authenticated visitor should land.
 *
 * The role owns the default destination: `admin` → `/admin`, `user` → `/watch`.
 * A caller-supplied `next` is honoured only when it points somewhere specific
 * (a deep link such as `/watch?channel=42`); every current flow passes an
 * explicit `/watch`, and letting that win would strand admins in the player.
 */
function resolveDestination(next: string, role: UserRole): string {
  return GENERIC_TARGETS.has(next) ? landingPathForRole(role) : next;
}

/**
 * Read the account's role with the credentials just established.
 *
 * Runs against the newly-set session cookies, so RLS narrows the query to the
 * caller's own row. Every failure mode — no user on the session, a missing row,
 * an unreadable table — resolves to `user`: a sign-in must never fail, and an
 * unreadable role must never grant the console.
 */
async function readRole(supabase: SupabaseClient, userId: string | null): Promise<UserRole> {
  if (!userId) return "user";

  try {
    const { data, error } = await supabase
      .from(PROFILES_TABLE)
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (error) return "user";
    return normalizeRole((data as { role?: unknown } | null)?.role);
  } catch {
    return "user";
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));
  // Always redirect back to whichever domain the visitor is actually using
  // (https://ipstreampulse.vercel.app, a preview URL, or a custom domain).
  const origin = resolveOrigin(request);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Auth responses must never be cached by browsers or intermediaries.
  const noStore = {
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  } as const;

  if (code && supabaseUrl && supabaseAnonKey) {
    const cookieStore = await cookies();
    // Secure cookies on the public HTTPS origin, even when the runtime itself
    // only sees an internal http:// hop behind the deployment proxy.
    const secure = origin.startsWith("https:");
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              // Session cookies: SameSite=Lax blocks cross-site sends (CSRF),
              // Secure on HTTPS, explicit path, bounded lifetime.
              sameSite: "lax",
              secure,
              path: "/",
              maxAge: options.maxAge ?? 60 * 60 * 24 * 30, // 30 days
            })
          );
        },
      },
    });

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // The session cookies are set on *this* response, so the role can be read
      // with the caller's own credentials before deciding where to send them.
      const userId = data.user?.id ?? data.session?.user?.id ?? null;
      const destination = resolveDestination(next, await readRole(supabase, userId));

      // Hand the visitor to their role's landing page on the same origin.
      return NextResponse.redirect(`${origin}${destination}`, { headers: noStore });
    }
    // Log the reason only — never echo provider internals to the client.
    console.error("OAuth code exchange failed:", error.message);
  }

  // Redirect to the sanitized target (or the channel view by default)
  return NextResponse.redirect(`${origin}${next}`, { headers: noStore });
}
