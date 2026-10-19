"use client";

import React, { useState } from "react";
import Link from "next/link";
import { KeyRound, LogOut, ShieldAlert, Terminal, TriangleAlert } from "lucide-react";
import { useProfile } from "@/context/ProfileContext";

/**
 * The `/admin` refusal screen.
 *
 * Rendered whenever the server cannot find `role = 'admin'` on the caller's
 * profile row, which covers three different situations that all deserve an
 * explanation rather than a redirect loop:
 *
 *   - nobody is signed in — offer Google sign-in;
 * - somebody is signed in without the role — say so, name the account, and
 *   offer to switch user or go back to the player;
 * - the role could not be read at all (usually a missing migration) — surface
 *    the reason under "Operator notes" instead of pretending the account was
 *    refused.
 *
 * It is a client component purely for the two buttons; the markup it renders
 * first is static and server-rendered, so the dark-themed page is what arrives.
 */

interface AccessDeniedProps {
  signedIn: boolean;
  /** The signed-in email, shown so a confused visitor can see which account is active. */
  email: string | null;
  /** False when Supabase is unconfigured, so a sign-in button could not work. */
  authAvailable: boolean;
  /** Why the role lookup failed — a missing `profiles` table, an unreachable project. */
  lookupError: string | null;
}

const PRIMARY =
  "inline-flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 text-xs font-bold text-white shadow-lg shadow-cyan-500/20 hover:brightness-110 transition disabled:opacity-60 disabled:cursor-not-allowed";

const SECONDARY =
  "inline-flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/10 transition disabled:opacity-60 disabled:cursor-not-allowed";

/** The bootstrap statement an operator needs, kept verbatim in one place. */
const GRANT_SQL = [
  "insert into public.profiles (id, role)",
  "select id, 'admin' from auth.users where email = 'you@example.com'",
  "on conflict (id) do update set role = excluded.role;",
].join("\n");

export default function AccessDenied({
  signedIn,
  email,
  authAvailable,
  lookupError,
}: AccessDeniedProps) {
  const { signInWithGoogle, signOut } = useProfile();
  const [busy, setBusy] = useState<"signin" | "switch" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Sign in (or swap account, then sign in).
   *
   * No explicit target is passed: the OAuth callback resolves the destination
   * from the account's role, so an administrator lands back on `/admin` while
   * anyone else is sent to `/watch` rather than being bounced here again.
   */
  const startSignIn = async (mode: "signin" | "switch") => {
    setMessage(null);
    setBusy(mode);
    try {
      if (mode === "switch") await signOut();
      await signInWithGoogle();
    } catch {
      setMessage("Could not reach the sign-in service. Check your connection and try again.");
      setBusy(null);
    }
  };

  // The notes are for whoever runs the deployment: worth showing when the
  // caller is known (a stranded admin) or when the setup itself is the problem.
  const showOperatorNotes = signedIn || !authAvailable || Boolean(lookupError);

  return (
    <div className="min-h-screen bg-[#05060a] text-slate-200 flex items-center justify-center px-4 py-16">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-gradient-to-tr from-rose-500/10 via-indigo-600/10 to-cyan-500/10 blur-[140px]" />
      </div>

      <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#0b0e16]/85 backdrop-blur-xl p-7 shadow-[0_30px_90px_-40px_rgba(0,0,0,1)]">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-rose-500 to-orange-500 flex items-center justify-center shadow-lg shadow-rose-500/25">
            <ShieldAlert className="w-5 h-5 text-black" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-rose-400/80">
              Error 403
            </p>
            <h1 className="text-xl font-black text-slate-50">Access Denied</h1>
          </div>
        </div>

        <p className="mt-5 text-xs text-slate-400 leading-relaxed">
          {signedIn ? (
            <>
              You are signed in as{" "}
              <span className="font-semibold text-slate-200">{email ?? "this account"}</span>, but
              that account is not an administrator. The console is limited to accounts whose role
              is <code className="text-cyan-300">admin</code>.
            </>
          ) : (
            <>
              This area is restricted to administrator accounts. Sign in with an account that has
              console access — or head back to the player.
            </>
          )}
        </p>

        {message && (
          <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
            {message}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2.5">
          {signedIn ? (
            <>
              <Link href="/watch" className={PRIMARY}>
                Back to the player
              </Link>
              <button
                type="button"
                onClick={() => void startSignIn("switch")}
                disabled={busy !== null || !authAvailable}
                className={SECONDARY}
              >
                <LogOut className="w-3.5 h-3.5" />
                {busy === "switch" ? "Opening Google…" : "Use a different account"}
              </button>
            </>
          ) : authAvailable ? (
            <>
              <button
                type="button"
                onClick={() => void startSignIn("signin")}
                disabled={busy !== null}
                className={PRIMARY}
              >
                <KeyRound className="w-3.5 h-3.5" />
                {busy === "signin" ? "Opening Google…" : "Sign in with Google"}
              </button>
              <Link href="/watch" className={SECONDARY}>
                Back to the player
              </Link>
            </>
          ) : (
            <Link href="/watch" className={PRIMARY}>
              Back to the player
            </Link>
          )}
        </div>

        {showOperatorNotes && (
          <details className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-4">
            <summary className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 cursor-pointer select-none">
              <Terminal className="w-3 h-3" />
              Operator notes
            </summary>

            <div className="mt-3 space-y-3 text-[11px] leading-relaxed text-slate-500">
              {lookupError && (
                <p className="flex items-start gap-1.5 text-amber-300/90">
                  <TriangleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                  <span>{lookupError}</span>
                </p>
              )}

              {!authAvailable && (
                <p className="text-amber-300/90">
                  Authentication is not configured: set{" "}
                  <code className="text-slate-400">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
                  <code className="text-slate-400">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then
                  restart the server.
                </p>
              )}

              <p>
                Access is granted by the <code className="text-slate-400">role</code> column of{" "}
                <code className="text-slate-400">public.profiles</code>. To make an account an
                administrator, run this in the Supabase SQL editor:
              </p>

              <pre className="rounded-xl border border-white/10 bg-black/60 p-3 text-[11px] leading-relaxed text-cyan-300 overflow-x-auto">
                <code>{GRANT_SQL}</code>
              </pre>

              <p>
                If that table does not exist yet, apply{" "}
                <code className="text-slate-400">
                  supabase/migrations/20261019000000_profiles_roles.sql
                </code>{" "}
                first. An existing administrator can also promote the account from the console&apos;s
                User Management tab.
              </p>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
