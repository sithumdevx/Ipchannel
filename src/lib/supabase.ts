import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRole, PROFILES_TABLE, type UserRole } from "@/lib/user-role";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/**
 * Fallback placeholder values used when the real Supabase credentials are
 * missing (e.g. during Next.js static builds / prerendering). They allow the
 * module to load without createClient() throwing an "Invalid supabaseUrl"
 * error, while isSupabaseConfigured() still reports the client as unconfigured.
 */
const FALLBACK_SUPABASE_URL = "https://placeholder.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "placeholder-anon-key";

/**
 * Checks if Supabase URL and anon key are present and not default placeholders
 */
export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl !== FALLBACK_SUPABASE_URL &&
    supabaseAnonKey !== FALLBACK_SUPABASE_ANON_KEY &&
    supabaseUrl !== "https://your-project.supabase.co" &&
    supabaseAnonKey !== "your-anon-key"
  );
};

// Singleton browser client instance cached in module scope
let clientInstance: SupabaseClient | null = null;

/**
 * Session cookie hardening applied to both browser and server-created clients:
 *  - `sameSite: "lax"` keeps the session cookie off cross-site requests (CSRF)
 *  - `secure` on HTTPS (and on loopback, which browsers treat as trustworthy)
 *  - explicit path + bounded lifetime (30 days, matching Supabase's refresh
 *    token lifetime) so a stale cookie can't outlive its refresh token
 *
 * Note: `httpOnly` stays false because @supabase/ssr stores the session in a
 * cookie the client JS must read; the real access boundary is Supabase RLS.
 */
function sessionCookieOptions() {
  const isLoopback =
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const isSecure =
    typeof window === "undefined" ||
    window.location.protocol === "https:" ||
    isLoopback;

  return {
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    secure: isSecure,
  };
}

/**
 * Returns a single shared instance of the Supabase browser client
 * Prevents multiple GoTrueClient instances in the browser context
 *
 * During builds/prerendering this never throws: if credentials are missing or
 * createClient() fails (e.g. invalid URL), it safely returns null instead.
 */
export const getSupabase = (): SupabaseClient | null => {
  if (!isSupabaseConfigured()) {
    return null;
  }

  // Fall back to placeholders so createClient() always receives a valid URL shape
  const url = supabaseUrl || FALLBACK_SUPABASE_URL;
  const key = supabaseAnonKey || FALLBACK_SUPABASE_ANON_KEY;

  try {
    // On the server, always create a fresh client
    if (typeof window === "undefined") {
      return createBrowserClient(url, key, { cookieOptions: sessionCookieOptions() });
    }

    // In the browser, reuse the single singleton instance
    if (!clientInstance) {
      clientInstance = createBrowserClient(url, key, { cookieOptions: sessionCookieOptions() });
    }

    return clientInstance;
  } catch {
    return null;
  }
};

/**
 * Proxy object for direct `supabase` exports that delegates to the singleton instance
 * without eagerly creating a duplicate GoTrueClient instance
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase();
    if (!client) {
      return undefined;
    }
    const val = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof val === "function") {
      return val.bind(client);
    }
    return val;
  },
});

/**
 * Read the signed-in account's role from `public.profiles`.
 *
 * Called right after a sign-in to decide between `/admin` and `/watch`. The
 * query runs as the caller, so row-level security limits it to their own row —
 * and because `authenticated` holds no write privilege on that table, the value
 * cannot be nudged from the browser. A missing row, an unreachable table, or an
 * unexpected value all resolve to `user`; see `normalizeRole`.
 */
export async function fetchUserRole(userId: string): Promise<UserRole> {
  const client = getSupabase();
  if (!client) return "user";

  try {
    const { data, error } = await client
      .from(PROFILES_TABLE)
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (error) return "user";
    return normalizeRole((data as { role?: unknown } | null)?.role);
  } catch {
    // Fail safe: an unreadable role is never an upgrade.
    return "user";
  }
}

