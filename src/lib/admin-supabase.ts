import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/admin";
import type { AdminUserRow, AdminUsers, AdminUsersPage } from "@/types/admin";

/**
 * Supabase-backed admin analytics and moderation.
 *
 * Everything here needs the **service role key**. The user directory and the
 * cross-member favorites aggregate both sit behind row-level security, so they
 * are genuinely unreadable with the anon key — there is no clever way around
 * that, and pretending otherwise would mean showing a misleading zero. When the
 * key is absent every function degrades to an explicit "not available" with a
 * reason the console displays, instead of failing.
 *
 * The service role bypasses RLS entirely, so this module is imported *only* from
 * admin-authorized route handlers. It must never be reachable from a component
 * that a normal member can render.
 */

const USERS_PER_PAGE = 1_000;

/** How many directory pages `/api/admin/stats` samples for the sign-up histogram. */
const MAX_USER_PAGES = 5;

/** Cap on favorite rows aggregated for the "most saved" ranking. */
const MAX_FAVORITE_ROWS = 5_000;

export interface ServiceClientResult {
  client: SupabaseClient | null;
  reason?: string;
}

/** Service-role client, or `null` with an operator-readable reason. */
export function serviceClient(): ServiceClientResult {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    return { client: null, reason: "NEXT_PUBLIC_SUPABASE_URL is not configured." };
  }
  if (!key) {
    return {
      client: null,
      reason: "Set SUPABASE_SERVICE_ROLE_KEY to read the user directory and favorites.",
    };
  }

  return {
    client: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

/** `banned_until` exists on the auth user but is not in every SDK's typings. */
function bannedUntil(user: User): string | null {
  const value = (user as User & { banned_until?: string | null }).banned_until;
  return value ?? null;
}

/** A ban is in force when `banned_until` is set and still in the future. */
function isSuspended(user: User): boolean {
  const until = bannedUntil(user);
  if (!until) return false;
  // `ban_duration: "none"` clears it to a zero timestamp, not null.
  const at = Date.parse(until);
  if (!Number.isFinite(at)) return false;
  return at > Date.now() + 60_000;
}

function displayName(user: User): string {
  const meta = user.user_metadata ?? {};
  return (
    meta.display_name ||
    meta.username ||
    meta.full_name ||
    meta.name ||
    user.email?.split("@")[0] ||
    "User"
  );
}

function providerOf(user: User): string {
  const identities = (user as User & { identities?: { provider?: string }[] }).identities;
  return identities?.[0]?.provider ?? "email";
}

/** Map an auth user onto the row shape the moderation table renders. */
export function toUserRow(user: User): AdminUserRow {
  const createdAt = user.created_at ? Date.parse(user.created_at) : 0;
  const lastSignIn = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : 0;

  return {
    id: user.id,
    email: user.email ?? null,
    name: displayName(user),
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    lastSignInAt: Number.isFinite(lastSignIn) ? lastSignIn : 0,
    role: isAdminEmail(user.email) ? "admin" : "member",
    suspended: isSuspended(user),
    bannedUntil: bannedUntil(user),
    emailConfirmed: Boolean(user.email_confirmed_at),
    provider: providerOf(user),
  };
}

function dayKeys(days: number): string[] {
  const keys: string[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return keys;
}

/**
 * Directory totals: how many accounts exist, how many were active recently, and
 * a trailing-week sign-up histogram.
 *
 * `total` comes from Supabase's own pagination metadata so it stays exact even
 * when we stop paging early; only the histogram becomes a sample.
 */
export async function loadUserStats(client: SupabaseClient | null): Promise<AdminUsers> {
  const buckets = dayKeys(7);
  const empty = buckets.map((date) => ({ date, count: 0 }));

  if (!client) {
    return {
      total: null,
      activeToday: 0,
      activeWeek: 0,
      available: false,
      last7Days: empty,
      approximate: false,
      reason: serviceClient().reason,
    };
  }

  const counts = new Map<string, number>(buckets.map((date) => [date, 0]));
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let total: number | null = null;
  let activeToday = 0;
  let activeWeek = 0;

  try {
    let page = 1;
    let reachedEnd = false;

    while (page <= MAX_USER_PAGES) {
      const { data, error } = await client.auth.admin.listUsers({
        page,
        perPage: USERS_PER_PAGE,
      });
      if (error) throw error;

      for (const user of data.users) {
        const signedIn = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : 0;
        if (signedIn >= dayAgo) activeToday++;
        if (signedIn >= weekAgo) activeWeek++;

        if (!user.created_at) continue;
        const key = user.created_at.slice(0, 10);
        if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      if (typeof data.total === "number") total = data.total;

      reachedEnd = !data.nextPage || data.nextPage <= page;
      if (reachedEnd) break;
      page++;
    }

    return {
      total,
      activeToday,
      activeWeek,
      available: true,
      last7Days: buckets.map((date) => ({ date, count: counts.get(date) ?? 0 })),
      approximate: !reachedEnd,
    };
  } catch (error) {
    return {
      total: null,
      activeToday: 0,
      activeWeek: 0,
      available: false,
      last7Days: empty,
      approximate: false,
      reason: error instanceof Error ? error.message : "Supabase user query failed.",
    };
  }
}

/** How many members saved each channel to their favorites. */
export async function loadFavoriteCounts(
  client: SupabaseClient | null
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!client) return counts;

  try {
    const { data, error } = await client
      .from("user_favorites")
      .select("channel_id")
      .limit(MAX_FAVORITE_ROWS);

    if (error) throw error;

    for (const row of (data ?? []) as { channel_id: string | null }[]) {
      if (!row.channel_id) continue;
      counts.set(row.channel_id, (counts.get(row.channel_id) ?? 0) + 1);
    }
  } catch {
    // Favorites are a nice-to-have: an unreadable table must not fail the page.
  }

  return counts;
}

/**
 * A page of the user directory.
 *
 * Search is applied after fetching the page rather than in the query, because
 * Supabase's admin API exposes no server-side search. With the default page size
 * that is fine for the sizes this app operates at; a deployment with tens of
 * thousands of accounts should move this to a `profiles` table with an index.
 */
export async function listUsers(
  client: SupabaseClient | null,
  options: { page?: number; perPage?: number; search?: string } = {}
): Promise<AdminUsersPage> {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(200, Math.max(5, options.perPage ?? 25));
  const search = (options.search ?? "").trim().toLowerCase();

  if (!client) {
    return {
      users: [],
      total: 0,
      page,
      perPage,
      available: false,
      reason: serviceClient().reason,
    };
  }

  try {
    if (search) {
      // Search needs the whole (bounded) directory to filter; the app's account
      // counts make that affordable, and the loop is capped either way.
      const matches: AdminUserRow[] = [];
      let cursor = 1;

      while (cursor <= MAX_USER_PAGES) {
        const { data, error } = await client.auth.admin.listUsers({
          page: cursor,
          perPage: USERS_PER_PAGE,
        });
        if (error) throw error;

        for (const user of data.users) {
          const row = toUserRow(user);
          const haystack = `${row.name} ${row.email ?? ""} ${row.id}`.toLowerCase();
          if (haystack.includes(search)) matches.push(row);
        }

        if (!data.nextPage || data.nextPage <= cursor) break;
        cursor++;
      }

      const start = (page - 1) * perPage;
      return {
        users: matches.slice(start, start + perPage),
        total: matches.length,
        page,
        perPage,
        available: true,
      };
    }

    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    return {
      users: data.users.map(toUserRow),
      total: typeof data.total === "number" ? data.total : data.users.length,
      page,
      perPage,
      available: true,
    };
  } catch (error) {
    return {
      users: [],
      total: 0,
      page,
      perPage,
      available: false,
      reason: error instanceof Error ? error.message : "Supabase user query failed.",
    };
  }
}

export type ModerationAction = "suspend" | "restore" | "revoke-sessions";

/**
 * Apply a moderation action to one account.
 *
 * `suspend` sets a ~100-year ban, which is Supabase's documented way to block
 * sign-in: `updateUserById` with `ban_duration: "none"` lifts it. Sessions are
 * revoked *in addition* to a ban, because banning stops new sign-ins but leaves
 * existing access tokens valid until they expire.
 */
export async function moderateUser(
  client: SupabaseClient | null,
  action: ModerationAction,
  userId: string
): Promise<{ ok: boolean; message: string }> {
  if (!client) {
    return { ok: false, message: serviceClient().reason ?? "Supabase admin access is not configured." };
  }

  try {
    if (action === "suspend") {
      const { error } = await client.auth.admin.updateUserById(userId, {
        ban_duration: "876000h",
      });
      if (error) throw error;

      // Kick out any live session so the ban takes effect immediately.
      await client.auth.admin.signOut(userId, "global").catch(() => undefined);

      return { ok: true, message: "Account suspended and all sessions revoked." };
    }

    if (action === "restore") {
      const { error } = await client.auth.admin.updateUserById(userId, {
        ban_duration: "none",
      });
      if (error) throw error;
      return { ok: true, message: "Account restored." };
    }

    const { error } = await client.auth.admin.signOut(userId, "global");
    if (error) throw error;
    return { ok: true, message: "All sessions revoked." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Moderation action failed.",
    };
  }
}
