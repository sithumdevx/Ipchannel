import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { normalizeRole, PROFILES_TABLE, type UserRole } from "@/lib/user-role";
import type { AdminUserRow, AdminUsers, AdminUsersPage } from "@/types/admin";

/**
 * Supabase-backed admin analytics, moderation, and role management.
 *
 * Everything here needs the **service role key**. The user directory, the
 * cross-member favorites aggregate, and every account's `role` all sit behind
 * row-level security, so they are genuinely unreadable with the anon key — there
 * is no clever way around that, and pretending otherwise would mean showing a
 * misleading zero. When the key is absent every function degrades to an explicit
 * "not available" with a reason the console displays, instead of failing.
 *
 * The service role bypasses RLS entirely, so this module is imported *only* from
 * admin-authorized route handlers. It must never be reachable from a component
 * that a normal member can render.
 */

const USERS_PER_PAGE = 1_000;

/** How many directory pages `/api/admin/stats` samples for the sign-up histogram. */
const MAX_USER_PAGES = 5;

/** Cap on the rows read from `profiles` when building the role map. */
const MAX_PROFILE_ROWS = 20_000;

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
export function toUserRow(user: User, roles: Map<string, UserRole>): AdminUserRow {
  const createdAt = user.created_at ? Date.parse(user.created_at) : 0;
  const lastSignIn = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : 0;

  return {
    id: user.id,
    email: user.email ?? null,
    name: displayName(user),
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    lastSignInAt: Number.isFinite(lastSignIn) ? lastSignIn : 0,
    /** A missing row is the normal state and reads as `user`. */
    role: roles.get(user.id) ?? "user",
    suspended: isSuspended(user),
    bannedUntil: bannedUntil(user),
    emailConfirmed: Boolean(user.email_confirmed_at),
    provider: providerOf(user),
  };
}

/**
 * The role map for the directory.
 *
 * `public.profiles` is sparse by design — only promoted accounts have a row (and
 * the signup trigger writes `user` for everyone else), so this is a small read
 * and the table doubles as the "who has console access" list. `role` is a single
 * indexed-by-primary-key column, so reading it whole is cheaper than a per-user
 * round trip for a page of results.
 *
 * An unreadable table (most often: the `profiles_roles` migration has not been
 * applied) yields an empty map rather than an error; every account then reads as
 * `user`, which is the safe direction.
 */
async function loadUserRoles(client: SupabaseClient): Promise<Map<string, UserRole>> {
  const roles = new Map<string, UserRole>();

  try {
    const { data, error } = await client
      .from(PROFILES_TABLE)
      .select("id, role")
      .limit(MAX_PROFILE_ROWS);

    if (error) throw error;

    for (const row of (data ?? []) as { id: string | null; role: unknown }[]) {
      if (row.id) roles.set(row.id, normalizeRole(row.role));
    }
  } catch {
    // See above: an empty map is the correct reading of "no role granted".
  }

  return roles;
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
 * The directory itself is Supabase's `auth.users` (the authority on who has an
 * account); `public.profiles` is joined in only for the `role` column. Search is
 * applied after fetching the page rather than in the query, because Supabase's
 * admin API exposes no server-side search. With the default page size that is
 * fine for the sizes this app operates at; a deployment with tens of thousands
 * of accounts should move the listing onto an indexed table of its own.
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
    const roles = await loadUserRoles(client);

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
          const row = toUserRow(user, roles);
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
      users: data.users.map((user) => toUserRow(user, roles)),
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

/**
 * Grant or revoke console access by writing `role` in `public.profiles`.
 *
 * `role` is the whole point of this write; the account's identity lives in
 * `auth.users`. The live `profiles` row also carries the address, so it is
 * refreshed here where available — as a bonus, that satisfies a legacy
 * `email text not null` column instead of failing on it.
 *
 * `id` is the primary key, so an upsert is both the "this account has no row
 * yet" path (most accounts do not) and a safe one when two administrators
 * promote the same person at once.
 */
export async function setUserRole(
  client: SupabaseClient | null,
  userId: string,
  role: UserRole
): Promise<{ ok: boolean; message: string }> {
  if (!client) {
    return { ok: false, message: "Supabase admin access is not configured." };
  }

  try {
    // Best effort: a missing address must not stop the role from being set.
    const { data: authUser } = await client.auth.admin.getUserById(userId);

    const row: { id: string; role: UserRole; email?: string } = { id: userId, role };
    const address = authUser?.user?.email;
    if (address) row.email = address;

    const { error } = await client.from(PROFILES_TABLE).upsert(row, { onConflict: "id" });

    if (error) throw error;

    return {
      ok: true,
      message:
        role === "admin"
          ? "Console access granted. It applies on their next page load."
          : "Console access revoked. They keep using the player.",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The role change failed.",
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
