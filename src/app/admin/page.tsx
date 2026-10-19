import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LayoutDashboard, ShieldAlert, Terminal } from "lucide-react";
import { adminConfigured, getSessionIdentity, isAdminEmail } from "@/lib/admin";
import AdminConsole from "./AdminConsole";

/**
 * Admin console (`/admin`).
 *
 * Access is decided *here*, on the server, before a single line of console
 * markup is rendered: the visitor's session cookie is validated against
 * Supabase (`auth.getUser()` — the token is checked with the Auth server, not
 * merely decoded), and the resulting email is compared against the
 * `ADMIN_EMAILS` allowlist.
 *
 * Nothing is inferred from being the first user, and no role column exists to
 * forge: the allowlist is the entire authorization model, so there is exactly
 * one place to audit. The `/api/admin/*` routes re-run the same check
 * independently, so even bypassing this page reaches nothing.
 *
 * When `ADMIN_EMAILS` is unset the page explains the one-time setup rather than
 * rendering an empty console that reads as broken — and, crucially, rather than
 * defaulting to open.
 */

export const metadata: Metadata = {
  title: "Admin Console — StreamPulse",
  description: "Internal system health, stream diagnostics and analytics.",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * This segment is allowed to block.
 *
 * An authorization decision has to read the session cookie and the
 * `ADMIN_EMAILS` environment variable, so there is no static shell to render —
 * pretending otherwise would mean prerendering either a redirect or the setup
 * notice and serving that to everyone. `instant = false` is the supported way
 * to say "render this on the server, per request, and let the navigation wait";
 * it is the Cache Components replacement for the old `dynamic = "force-dynamic"`.
 */
export const instant = false;

export default async function AdminPage() {
  // Defer to request time *before* the first env read.
  //
  // `adminConfigured()` short-circuits everything below it when `ADMIN_EMAILS`
  // is unset, which is exactly the state a build runs in. Without this line that
  // early return is the only branch a prerender ever takes — so `cookies()` is
  // never reached, Next happily emits a static page, and the console would serve
  // a baked "no admin configured" notice forever, even after the allowlist is
  // set on the running server. `connection()` makes the env read happen per
  // request, which is what an authorization decision requires.
  await connection();

  if (!adminConfigured()) {
    return <SetupNotice />;
  }

  const identity = await getSessionIdentity();

  if (!isAdminEmail(identity?.email)) {
    // Anonymous visitors go to the sign-in wall, signed-in non-admins into the
    // app. Either way the console stays out of reach.
    redirect("/watch");
  }

  return <AdminConsole adminName={identity?.name ?? "Administrator"} />;
}

/** Shown only when `ADMIN_EMAILS` is unset, so the first run is self-explaining. */
function SetupNotice() {
  return (
    <div className="min-h-screen bg-[#05060a] text-slate-200 flex items-center justify-center px-4 py-16">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-gradient-to-tr from-cyan-500/10 via-indigo-600/10 to-purple-600/10 blur-[140px]" />
      </div>

      <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#0b0e16]/85 backdrop-blur-xl p-7 shadow-[0_30px_90px_-40px_rgba(0,0,0,1)]">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25">
            <ShieldAlert className="w-5 h-5 text-black" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-50">No admin account configured</h1>
            <p className="text-[11px] text-slate-500">The console is locked until an owner is named.</p>
          </div>
        </div>

        <p className="mt-5 text-xs text-slate-400 leading-relaxed">
          Admin access is an explicit email allowlist — nothing is inferred from being the first
          user, and no role is stored in the database. Add the operator&apos;s email address and the
          console unlocks on the next request.
        </p>

        <div className="mt-5 rounded-2xl bg-black/40 border border-white/10 p-4">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            <Terminal className="w-3 h-3" />
            .env.local / Vercel environment
          </p>
          <pre className="text-[11px] leading-relaxed text-cyan-300 overflow-x-auto">
            <code>ADMIN_EMAILS=you@example.com,teammate@example.com</code>
          </pre>
          <p className="text-[10px] text-slate-500 mt-2">
            Comma-separated. Optionally add{" "}
            <code className="text-slate-400">SUPABASE_SERVICE_ROLE_KEY</code> to unlock registered
            user counts, the favorites ranking, and the user management table.
          </p>
        </div>

        <Link
          href="/watch"
          className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/10 transition"
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          Back to the app
        </Link>
      </div>
    </div>
  );
}
