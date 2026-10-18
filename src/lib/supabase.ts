import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

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
      return createBrowserClient(url, key);
    }

    // In the browser, reuse the single singleton instance
    if (!clientInstance) {
      clientInstance = createBrowserClient(url, key);
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
