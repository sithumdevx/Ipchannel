import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  listUsers,
  moderateUser,
  serviceClient,
  setUserRole,
  type ModerationAction,
} from "@/lib/admin-supabase";

/**
 * User management: moderation and roles.
 *
 * All of this runs on the Supabase **service role** key, because the directory,
 * the ban state, and every account's `role` are not readable or writable through
 * RLS. That makes this route the single most privileged surface in the app, so:
 *
 *   - `requireAdmin()` runs before the body is even parsed;
 *   - the actions a caller may request come from a fixed list, and the target is
 *     only ever an opaque user id;
 *   - an admin cannot act on their own account at all, so a mis-click cannot
 *     lock the operator out — and, because demoting yourself is impossible,
 *     there is always at least one administrator left;
 *   - when the service key is absent, the response says exactly that rather than
 *     reporting an empty directory.
 */


const VALID_ACTIONS = ["suspend", "restore", "revoke-sessions", "promote", "demote"] as const;
type ActionName = (typeof VALID_ACTIONS)[number];

function parseAction(value: unknown): ActionName | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().toLowerCase();
  return (VALID_ACTIONS as readonly string[]).includes(normalised)
    ? (normalised as ActionName)
    : null;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { client, reason } = serviceClient();
  if (!client) {
    return NextResponse.json(
      { users: [], total: 0, page: 1, perPage: 25, available: false, reason },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const perPage = Math.min(200, Math.max(5, Number(params.get("perPage")) || 25));
  const search = (params.get("search") ?? "").slice(0, 80);

  const result = await listUsers(client, { page, perPage, search });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const action = parseAction(body.action);
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";

  if (!action) {
    return NextResponse.json(
      { error: `Unknown action. Expected one of: ${VALID_ACTIONS.join(", ")}.` },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!userId) {
    return NextResponse.json(
      { error: "A userId is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Refuse to act on the caller's own account: an admin locking themselves out —
  // or demoting themselves — is the one mistake an operator cannot undo from
  // this UI. It also guarantees at least one administrator always remains.
  if (userId === gate.admin.id) {
    return NextResponse.json(
      { error: "You cannot act on your own account from here." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { client, reason } = serviceClient();
  if (!client) {
    return NextResponse.json(
      { error: reason ?? "Supabase admin access is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Roles and moderation are different writes against different services (the
  // `profiles` table vs. the Auth admin API), so they get different functions
  // rather than one action string with branches inside it.
  const result =
    action === "promote" || action === "demote"
      ? await setUserRole(client, userId, action === "promote" ? "admin" : "user")
      : await moderateUser(client, action as ModerationAction, userId);

  return NextResponse.json(
    { ok: result.ok, message: result.message, action, userId },
    { status: result.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } }
  );
}
