/**
 * The role contract, in one place.
 *
 * Authorization in StreamPulse is one value on one row: `role` in
 * `public.profiles`. `admin` may open `/admin` and call `/api/admin/*`;
 * `user` — the default for every account — may not.
 *
 * Both sides of the split need the same definition: the server reads a role to
 * decide whether to render the console, and the browser reads one to decide
 * where a fresh sign-in lands. Keeping the type, the table name, and the
 * normalization in a dependency-free module stops those two copies from
 * drifting.
 */

export type UserRole = "admin" | "user";

/** Table holding one row per account. See the `profiles_roles` migration. */
export const PROFILES_TABLE = "profiles";

/**
 * Coerce whatever the database returned into a role.
 *
 * Anything unrecognised — a missing row, a null, a value written by a newer
 * schema — resolves to the least privilege. Authorization must never fail
 * *open* because a lookup came back empty or surprising.
 */
export function normalizeRole(value: unknown): UserRole {
  return value === "admin" ? "admin" : "user";
}

/**
 * Where a freshly signed-in account is sent, by role.
 *
 * Admins land on the console; everyone else lands in the player. This is the
 * single definition behind both the OAuth callback's redirect and the in-tab
 * sign-in redirect, so the two cannot disagree.
 */
export function landingPathForRole(role: UserRole): string {
  return role === "admin" ? "/admin" : "/watch";
}
