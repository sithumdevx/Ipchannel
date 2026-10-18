"use client";

import React from "react";
import Link from "next/link";
import { Lock, Play, Tv, UserPlus, Sparkles, ArrowLeft } from "lucide-react";
import { useProfile } from "@/context/ProfileContext";

/**
 * Mandatory-authentication gate.
 *
 * Wraps every view of the actual application (the channel browser / player).
 * Guest mode has been removed: without an authenticated Supabase session the
 * app renders a cinematic sign-in wall instead of the content. While the
 * initial session restore is still resolving, a branded spinner is shown so
 * signed-in users never see a flash of the wall.
 *
 * The unauthenticated wall also works when Supabase isn't configured yet — it
 * swaps the CTA buttons for setup instructions.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { supabaseUser, isAuthReady, isSupabaseActive, openAuthModal } = useProfile();

  // Still restoring the session — keep the door quiet.
  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-cyan-500/30 animate-pulse">
              <Tv className="w-7 h-7 text-white" />
            </div>
          </div>
          <div className="w-48 h-1 rounded-full bg-line2 overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-cyan-400 to-purple-500 animate-pulse" />
          </div>
          <span className="text-xs text-faint">Checking your session…</span>
        </div>
      </div>
    );
  }

  // Authenticated → the app itself.
  if (supabaseUser) {
    return <>{children}</>;
  }

  // Unauthenticated → cinematic sign-in wall.
  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-16 overflow-hidden bg-app text-ink">
      {/* Ambient cinematic background */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-gradient-to-tr from-cyan-500/15 via-indigo-600/15 to-purple-600/20 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute bottom-0 left-10 w-80 h-80 bg-cyan-700/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-24 right-8 w-72 h-72 bg-purple-700/15 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)] pointer-events-none" />

      <div className="relative w-full max-w-md">
        {/* Glass card */}
        <div className="relative p-7 sm:p-9 rounded-[2rem] bg-glass backdrop-blur-2xl border border-line2 shadow-2xl shadow-shadow ring-1 ring-line text-center overflow-hidden">
          <div className="absolute -top-20 -right-20 w-44 h-44 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-16 w-44 h-44 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

          {/* Lock emblem */}
          <div className="relative mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-cyan-500/30 mb-5">
            <Lock className="w-8 h-8 text-white" />
            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-black/80 border border-cyan-400/50 flex items-center justify-center">
              <Play className="w-2.5 h-2.5 text-cyan-300 fill-current ml-0.5" />
            </span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[11px] font-semibold mb-4 backdrop-blur-md">
            <Sparkles className="w-3 h-3" />
            <span>Sign-in required to watch</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white leading-tight">
            The player is{" "}
            <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              members-only
            </span>
          </h1>

          <p className="text-sm text-dim mt-3 leading-relaxed">
            StreamPulse no longer offers guest access. Create a free account (or sign in) to
            unlock 30,000+ live channels, cloud-synced favorites, and your watch history.
          </p>

          {isSupabaseActive ? (
            <div className="mt-7 space-y-3">
              <button
                onClick={() => openAuthModal("signin")}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-black font-extrabold text-sm shadow-xl shadow-cyan-500/25 transition active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                <span>Sign In &amp; Continue</span>
              </button>

              <button
                onClick={() => openAuthModal("signup")}
                className="w-full py-3.5 rounded-2xl bg-glass hover:bg-glass2 text-ink font-bold text-sm border border-line2 hover:border-line2 backdrop-blur-md transition active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <UserPlus className="w-4 h-4 text-cyan-300" />
                <span>Create Free Account</span>
              </button>

              <p className="text-[11px] text-faint pt-1">
                Google OAuth or email + username + password · takes less than a minute.
              </p>
            </div>
          ) : (
            <div className="mt-7 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs text-left leading-relaxed">
              <span className="font-bold block mb-1">Setup required</span>
              Add <code className="font-mono text-amber-300">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code className="font-mono text-amber-300">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
              <code className="font-mono text-amber-300">.env.local</code>, then restart the dev
              server to enable sign-in.
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-line">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-dim hover:text-cyan-300 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to home</span>
            </Link>
          </div>
        </div>

        <p className="text-center text-[11px] text-faint mt-5">
          Free forever · No credit card · Developed by Sithum Thilina
        </p>
      </div>
    </div>
  );
}
