import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

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

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));

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
    const secure = request.nextUrl.protocol === "https:";
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

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`, { headers: noStore });
    }
    // Log the reason only — never echo provider internals to the client.
    console.error("OAuth code exchange failed:", error.message);
  }

  // Redirect to the sanitized target (or the channel view by default)
  return NextResponse.redirect(`${origin}${next}`, { headers: noStore });
}
