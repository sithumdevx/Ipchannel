"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban,
  CircleCheck,
  CircleX,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  UserCog,
  Users,
} from "lucide-react";
import type { AdminUserRow, AdminUsersPage } from "@/types/admin";
import { Panel } from "@/components/admin/charts";

/**
 * User management: roles and moderation.
 *
 * The directory is Supabase's `auth.users` (who has an account); the `role`
 * column comes from `public.profiles` and is the only thing that grants console
 * access. Two rules shape the table:
 *
 *  - **A role can be changed here and nowhere else.** The toggle writes
 *    `public.profiles.role` through the service role; members hold no write
 *    privilege on that table, so `admin` cannot be granted from a client.
 *  - **No operator can act on their own account.** The server refuses it
 *    outright and the buttons are disabled here, so the refusal is visible
 *    before the request rather than only as an error after it. It also means the
 *    last administrator on a deployment cannot demote or suspend themselves out
 *    of the console.
 *
 * When the service-role key is absent the table says so and explains what to
 * set, instead of rendering zero users, which would read as "nobody has
 * registered".
 */

const PER_PAGE = 25;

type ModerationAction = "suspend" | "restore" | "revoke-sessions" | "promote" | "demote";

interface Notice {
  tone: "ok" | "error";
  text: string;
}

function formatTime(epochMs: number): string {
  if (!epochMs) return "never";
  return new Date(epochMs).toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatAge(epochMs: number): string {
  if (!epochMs) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function UsersPanel({ adminId }: { adminId: string }) {
  const [data, setData] = useState<AdminUsersPage | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  /** Which row is currently awaiting a moderation response. */
  const [pending, setPending] = useState<string | null>(null);
  /**
   * Confirmation state: `{ userId, action }` when a destructive button has been
   * pressed once and is waiting for the second press that actually runs it.
   */
  const [confirming, setConfirming] = useState<{ userId: string; action: ModerationAction } | null>(
    null
  );

  const inFlight = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Promise chain rather than `async`/`await`, so every `setState` sits inside
   * a callback and the effect stays a subscription rather than a render-time
   * state write. See AdminConsole.load for the same reasoning.
   */
  const load = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;

    const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
    if (search.trim()) params.set("search", search.trim());

    fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.json() as Promise<AdminUsersPage>;
      })
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load users.");
      })
      .finally(() => {
        setLoading(false);
        inFlight.current = false;
      });
  }, [page, search]);

  useEffect(() => {
    load();
  }, [load]);

  const changeSearch = (next: string) => {
    setSearch(next);
    setPage(1);
    if (debounce.current) clearTimeout(debounce.current);
  };

  const moderate = async (userId: string, action: ModerationAction) => {
    // Second press confirms; the first only arms the button.
    if (!confirming || confirming.userId !== userId || confirming.action !== action) {
      setConfirming({ userId, action });
      return;
    }

    setConfirming(null);
    setPending(userId);
    setNotice(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId }),
      });

      const payload = (await response.json()) as { ok?: boolean; message?: string; error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? payload.message ?? `Request failed (${response.status})`);
      }

      setNotice({ tone: "ok", text: payload.message ?? "Done." });
      load();
    } catch (err) {
      setNotice({
        tone: "error",
        text: err instanceof Error ? err.message : "Moderation action failed.",
      });
    } finally {
      setPending(null);
    }
  };

  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const isArmed = (userId: string, action: ModerationAction) =>
    confirming?.userId === userId && confirming?.action === action;

  /* ---------------------------------------------------------------------- */
  /* Unconfigured state                                                      */
  /* ---------------------------------------------------------------------- */

  if (data && data.available === false) {
    return (
      <Panel
        title="User Management"
        subtitle="Registered accounts and moderation"
        icon={<Users className="w-4 h-4" />}
      >
        <div className="py-10 text-center">
          <Ban className="w-8 h-8 text-amber-400/60 mx-auto" />
          <p className="mt-3 text-sm font-bold text-slate-200">Directory unavailable</p>
          <p className="mt-1.5 text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            {data.reason ??
              "The Supabase service-role key is not set on this deployment, so the user directory cannot be read."}
          </p>
          <div className="mt-5 mx-auto max-w-md rounded-2xl border border-white/10 bg-black/40 p-4 text-left">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
              To enable this tab
            </p>
            <pre className="text-[11px] leading-relaxed text-cyan-300 overflow-x-auto">
              <code>SUPABASE_SERVICE_ROLE_KEY=…</code>
            </pre>
            <p className="text-[10px] text-slate-600 mt-2 leading-relaxed">
              The same key powers the total-user count, the 7-day sign-up histogram and the
              favorites ranking. Read the full reason: {data.reason ? "see above" : "not available"}.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  /* ---------------------------------------------------------------------- */

  return (
    <Panel
      title="User Management"
      subtitle="Status, access and moderation actions"
      icon={<UserCog className="w-4 h-4" />}
      action={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder="Search email or name…"
              aria-label="Search users"
              className="w-44 sm:w-56 rounded-xl border border-white/10 bg-white/[0.04] pl-8 pr-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 outline-none focus:border-cyan-500/50 focus:bg-white/[0.07] transition"
            />
          </div>
          <button
            type="button"
            onClick={() => load()}
            title="Reload the directory"
            className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-slate-400 hover:bg-white/[0.08] hover:text-slate-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <TriangleAlert className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => load()}
            className="text-[10px] font-bold uppercase tracking-wider underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {notice && (
        <div
          className={`mb-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
            notice.tone === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/30 bg-rose-500/10 text-rose-200"
          }`}
          role="status"
        >
          {notice.tone === "ok" ? (
            <CircleCheck className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          ) : (
            <CircleX className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          )}
          <span className="flex-1">{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="text-[10px] uppercase tracking-wider opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-11 rounded-xl bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="py-10 text-center">
          <CircleCheck className="w-8 h-8 text-emerald-400/70 mx-auto" />
          <p className="mt-3 text-sm text-slate-300 font-semibold">
            {search ? "No accounts match that search." : "No accounts yet."}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {search ? "Clear the search to list everyone." : "The directory is empty."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                <th className="pb-2.5 pr-3 font-semibold">Account</th>
                <th className="pb-2.5 pr-3 font-semibold">Role</th>
                <th className="pb-2.5 pr-3 font-semibold">Status</th>
                <th className="pb-2.5 pr-3 font-semibold">Last sign-in</th>
                <th className="pb-2.5 pr-3 font-semibold">Provider</th>
                <th className="pb-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  adminId={adminId}
                  busy={pending === user.id}
                  armed={isArmed}
                  onAction={(action) => void moderate(user.id, action)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500 tabular-nums">
            {total.toLocaleString()} accounts · page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-300 disabled:opacity-30 enabled:hover:bg-white/[0.08] transition"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-slate-300 disabled:opacity-30 enabled:hover:bg-white/[0.08] transition"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
          <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0 mt-px text-emerald-400/70" />
          <span>
            Promote and Demote set this account&apos;s{" "}
            <span className="text-slate-400">role</span> in{" "}
            <span className="text-slate-400">public.profiles</span> — that column is the whole
            authorization model, so it is written through the service role and cannot be set from a
            client. It takes effect on the account&apos;s next page load. Suspend bans the account in
            Supabase and signs it out everywhere; Restore lifts the ban; Revoke signs every session
            out without banning, which is the right tool for a leaked token.
          </span>
        </p>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function UserRow({
  user,
  adminId,
  busy,
  armed,
  onAction,
}: {
  user: AdminUserRow;
  /** The signed-in operator's id — their own row is never actionable. */
  adminId: string;
  busy: boolean;
  armed: (userId: string, action: ModerationAction) => boolean;
  onAction: (action: ModerationAction) => void;
}) {
  const isSelf = user.id === adminId;

  /** Suffix that explains a disabled button in its tooltip. */
  const selfNote = isSelf ? " You cannot act on your own account." : "";

  const isSelfArmed = (action: ModerationAction) => armed(user.id, action);
  // Mirrors the server's refusal, so the reason is visible before the click
  // rather than only as an error afterwards.
  const disabled = busy || isSelf;

  const buttonClass = (active: boolean, tone: "amber" | "rose" | "cyan" | "slate") => {
    const palette = {
      amber: { border: "#fbbf24", bg: "#fbbf241a", fg: "#fcd34d" },
      rose: { border: "#fb7185", bg: "#fb71851a", fg: "#fda4af" },
      cyan: { border: "#22d3ee", bg: "#22d3ee1a", fg: "#67e8f9" },
      slate: { border: "#64748b", bg: "#64748b1a", fg: "#cbd5e1" },
    }[tone];

    return active
      ? { borderColor: palette.border, background: palette.bg, color: palette.fg }
      : { borderColor: "rgba(255,255,255,0.12)", background: "transparent", color: "#94a3b8" };
  };

  return (
    <tr className={`transition ${busy ? "opacity-60" : "hover:bg-white/[0.03]"}`}>
      <td className="py-2.5 pr-3 max-w-[260px]">
        <p className="text-xs font-semibold text-slate-200 truncate">
          {user.email ?? <span className="text-slate-600 italic">no email</span>}
        </p>
        <p className="text-[10px] text-slate-600 truncate">
          {user.name || "—"} · joined {formatTime(user.createdAt)}
          {!user.emailConfirmed && " · unconfirmed"}
        </p>
      </td>

      <td className="py-2.5 pr-3">
        <span
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            user.role === "admin"
              ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
              : "border-white/10 bg-white/[0.04] text-slate-400"
          }`}
          title={
            user.role === "admin"
              ? "Role `admin` in public.profiles — this account can open the console."
              : "Role `user` — an ordinary member account."
          }
        >
          {user.role === "admin" && <ShieldCheck className="w-3 h-3" />}
          {user.role}
        </span>
      </td>

      <td className="py-2.5 pr-3">
        {user.suspended ? (
          <span className="inline-flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-300">
              <Ban className="w-3 h-3" />
              Suspended
            </span>
            {user.bannedUntil && (
              <span className="text-[9px] text-slate-600">
                until {new Date(user.bannedUntil).toLocaleDateString()}
              </span>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
            <CircleCheck className="w-3 h-3" />
            Active
          </span>
        )}
      </td>

      <td className="py-2.5 pr-3 text-xs text-slate-400 tabular-nums whitespace-nowrap">
        {formatAge(user.lastSignInAt)}
      </td>

      <td className="py-2.5 pr-3">
        <span className="text-[11px] text-slate-500 capitalize">{user.provider}</span>
      </td>

      <td className="py-2.5">
        <div className="flex items-center justify-end gap-1.5">
          {/* Role toggle. The button always names the role the account does
              *not* have, so the label already describes the outcome; promoting
              is the only action here that widens access, so it is styled to
              stand apart from the moderation pair. */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAction(user.role === "admin" ? "demote" : "promote")}
            title={
              (user.role === "admin"
                ? "Remove console access: set this account's role back to user."
                : "Grant console access: set this account's role to admin.") + selfNote
            }
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={
              isSelfArmed(user.role === "admin" ? "demote" : "promote")
                ? user.role === "admin"
                  ? { borderColor: "#fbbf24", background: "#fbbf241a", color: "#fcd34d" }
                  : { borderColor: "#22d3ee", background: "#22d3ee1a", color: "#67e8f9" }
                : buttonClass(false, user.role === "admin" ? "slate" : "cyan")
            }
          >
            {busy ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : isSelfArmed(user.role === "admin" ? "demote" : "promote") ? (
              user.role === "admin" ? (
                <>Confirm demote</>
              ) : (
                <>Confirm promote</>
              )
            ) : (
              <>
                {user.role === "admin" ? <ShieldCheck className="w-3 h-3" /> : <UserCog className="w-3 h-3" />}
                {user.role === "admin" ? "Demote" : "Promote"}
              </>
            )}
          </button>

          {/* Suspend / restore share one toggle button so the affordance never
              implies two independent operations on the same row. */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAction(user.suspended ? "restore" : "suspend")}
            title={
              (user.suspended
                ? "Lift the ban and let this account sign in again."
                : "Ban this account and sign it out everywhere.") + selfNote
            }
            className="rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={
              isSelfArmed(user.suspended ? "restore" : "suspend")
                ? user.suspended
                  ? { borderColor: "#34d399", background: "#34d3991a", color: "#6ee7b7" }
                  : { borderColor: "#fbbf24", background: "#fbbf241a", color: "#fcd34d" }
                : buttonClass(false, user.suspended ? "slate" : "amber")
            }
          >
            {busy ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : isSelfArmed(user.suspended ? "restore" : "suspend") ? (
              user.suspended ? (
                <>Confirm restore</>
              ) : (
                <>Confirm suspend</>
              )
            ) : user.suspended ? (
              "Restore"
            ) : (
              "Suspend"
            )}
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={() => onAction("revoke-sessions")}
            title={
              "Sign every session out without banning — for a leaked or shared token." + selfNote
            }
            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={
              isSelfArmed("revoke-sessions")
                ? { borderColor: "#fb7185", background: "#fb71851a", color: "#fda4af" }
                : buttonClass(false, "rose")
            }
          >
            {busy ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : isSelfArmed("revoke-sessions") ? (
              "Confirm revoke"
            ) : (
              <>
                <KeyRound className="w-3 h-3" />
                Revoke
              </>
            )}
          </button>
        </div>
      </td>
    </tr>
  );
}
