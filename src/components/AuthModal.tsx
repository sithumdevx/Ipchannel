"use client";

import React, { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  X,
  User,
  Check,
  LogOut,
  AlertCircle,
  Cloud,
  Heart,
  History,
  Trash2,
  Save,
  CheckCircle2,
  Image as ImageIcon,
  Palette,
  Settings,
  Mail,
  Lock,
  AtSign,
  Eye,
  EyeOff,
  UserPlus,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useProfile } from "@/context/ProfileContext";

const AVATAR_COLORS = [
  { name: "Cyan Neon", class: "from-cyan-500 to-blue-600" },
  { name: "Electric Violet", class: "from-purple-500 to-indigo-600" },
  { name: "Rose Glow", class: "from-rose-500 to-pink-600" },
  { name: "Emerald Jade", class: "from-emerald-500 to-teal-700" },
  { name: "Amber Sunset", class: "from-amber-500 to-orange-600" },
  { name: "Sunset Crimson", class: "from-red-500 to-purple-700" },
];

type AuthMode = "signin" | "signup";

/** Shared input shell so Google + email flows look like one system. */
const INPUT_CLASS =
  "w-full pl-10 pr-4 py-3 rounded-2xl bg-slate-900 text-sm text-white placeholder-slate-500 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition";

/**
 * Renders nothing while closed. The heavy panel below is mounted only while the
 * modal is open, so all of its state (mode, form fields, feedback, confirm
 * prompts) is freshly seeded from context on every open — no reset effects.
 */
export default function AuthModal() {
  const { isAuthModalOpen } = useProfile();
  if (!isAuthModalOpen) return null;
  return <AuthPanel />;
}

function AuthPanel() {
  const {
    setIsAuthModalOpen,
    authModalView,
    currentProfile,
    supabaseUser,
    isSupabaseActive,
    isAuthSubmitting,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    updateProfile,
    clearAllFavorites,
  } = useProfile();

  // Active sub-tab when user is logged in
  const [activeTab, setActiveTab] = useState<"profile" | "account">("profile");

  // Sign-in / sign-up panel (seeded by whichever CTA opened the modal)
  const [mode, setMode] = useState<AuthMode>(authModalView);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const router = useRouter();
  const pathname = usePathname();

  /**
   * After a successful sign-in jump straight into the channel browsing/player
   * view instead of leaving the user on the Home hero landing page. No-op once
   * they are already inside the player.
   */
  const goToChannelView = () => {
    if (["/", "/developer", "/about"].includes(pathname)) {
      router.push("/watch");
    }
  };

  // Edit form states
  const [displayName, setDisplayName] = useState(currentProfile.name);
  const [selectedAvatarColor, setSelectedAvatarColor] = useState(
    currentProfile.avatarColor || AVATAR_COLORS[0].class
  );
  const [useGooglePhoto, setUseGooglePhoto] = useState(currentProfile.useGoogleAvatar ?? Boolean(currentProfile.avatarUrl));

  // Action feedback states
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [showClearFavoritesConfirm, setShowClearFavoritesConfirm] = useState(false);
  const [isClearingFavorites, setIsClearingFavorites] = useState(false);

  // NOTE: display name / avatar form fields are seeded from the current profile
  // in useState initializers above; the panel remounts on every open, so no
  // sync effect is needed.

  const rawGooglePhoto =
    supabaseUser?.user_metadata?.avatar_url ||
    supabaseUser?.user_metadata?.picture ||
    currentProfile.avatarUrl;

  const usernameMeta = (supabaseUser?.user_metadata?.username as string | undefined) || null;
  const authProvider = (supabaseUser?.app_metadata?.provider as string | undefined) || "email";

  // Save changes handler
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;

    setIsSaving(true);
    setSaveSuccess(false);

    try {
      await updateProfile(displayName, selectedAvatarColor, useGooglePhoto && Boolean(rawGooglePhoto));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  // Google Sign In handler
  const handleGoogleSignIn = async () => {
    if (!isSupabaseActive) {
      setAuthError(
        "Authentication is not configured yet. Add your Supabase URL and anon key to .env.local."
      );
      return;
    }
    try {
      setIsGoogleLoading(true);
      setAuthError(null);
      setInfoNotice(null);
      await signInWithGoogle();
      // Note: Google OAuth navigates away from this page; no local cleanup.
    } catch (err: unknown) {
      console.error(err);
      setAuthError((err as Error).message || "Google Sign-In failed.");
      setIsGoogleLoading(false);
    }
  };

  // Email + password sign-in / username + email + password registration
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setInfoNotice(null);

    if (!email.trim()) {
      setAuthError("Please enter your email address.");
      return;
    }
    if (password.length < 8) {
      setAuthError("Password must be at least 8 characters long.");
      return;
    }

    if (mode === "signup") {
      const trimmedUsername = username.trim();
      if (trimmedUsername.length < 3) {
        setAuthError("Username must be at least 3 characters.");
        return;
      }

      const res = await signUpWithEmail(trimmedUsername, email, password);
      if (!res.ok) {
        setAuthError(res.message || "Registration failed. Please try again.");
        return;
      }

      if (res.needsEmailConfirmation) {
        // Account exists but is unconfirmed: explain, then land on sign-in.
        setInfoNotice(res.message || "Account created — check your inbox for the confirmation link.");
        setMode("signin");
        setPassword("");
        return;
      }

      // Confirmed instantly (auto-confirm enabled) → enter the app.
      setIsAuthModalOpen(false);
      goToChannelView();
      return;
    }

    const res = await signInWithEmail(email, password);
    if (!res.ok) {
      setAuthError(res.message || "Sign-in failed. Please try again.");
      return;
    }

    setIsAuthModalOpen(false);
    goToChannelView();
  };

  // Clear favorites confirmation handler
  const handleConfirmClearFavorites = async () => {
    setIsClearingFavorites(true);
    try {
      await clearAllFavorites();
      setShowClearFavoritesConfirm(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsClearingFavorites(false);
    }
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setAuthError(null);
    setInfoNotice(null);
    setShowPassword(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-lg p-6 sm:p-8 bg-[#0b0e17] border border-white/10 rounded-3xl shadow-2xl ring-1 ring-cyan-500/20 max-h-[92vh] overflow-y-auto">
        {/* Glow ambient background effects */}
        <div className="absolute -top-24 -left-24 w-52 h-52 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-52 h-52 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={() => {
            setIsAuthModalOpen(false);
            setShowClearFavoritesConfirm(false);
          }}
          className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3.5 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-cyan-500/30 flex-shrink-0">
            {supabaseUser ? <Settings className="w-6 h-6" /> : <User className="w-6 h-6" />}
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-snug">
              {supabaseUser
                ? "Profile & Settings"
                : mode === "signup"
                  ? "Create your account"
                  : "Welcome back"}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {supabaseUser
                ? "Manage your display name, avatar style, and cloud data."
                : mode === "signup"
                  ? "Pick a username, or continue with Google — favorites sync everywhere."
                  : "Sign in to unlock the player, cloud favorites, and history."}
            </p>
          </div>
        </div>

        {authError && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span>{authError}</span>
          </div>
        )}

        {infoNotice && (
          <div className="mb-4 p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-cyan-400" />
            <span>{infoNotice}</span>
          </div>
        )}

        {/* SUCCESS TOAST NOTIFICATION */}
        {saveSuccess && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
            <span>Changes saved successfully to your profile!</span>
          </div>
        )}

        {/* =========================================================================
            LOGGED-IN VIEW: FULL EDIT PROFILE & SETTINGS
           ========================================================================= */}
        {supabaseUser ? (
          <div className="space-y-6">
            {/* Navigation Tabs */}
            <div className="flex items-center p-1 rounded-2xl bg-slate-900 border border-slate-800">
              <button
                type="button"
                onClick={() => setActiveTab("profile")}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  activeTab === "profile"
                    ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Palette className="w-3.5 h-3.5" />
                <span>Profile & Avatar</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("account")}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  activeTab === "account"
                    ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>Account & Data</span>
              </button>
            </div>

            {/* TAB 1: EDIT PROFILE & AVATAR */}
            {activeTab === "profile" && (
              <form onSubmit={handleSaveProfile} className="space-y-5">
                {/* Live Avatar Preview */}
                <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center gap-4">
                  <div className="relative">
                    {useGooglePhoto && rawGooglePhoto ? (
                      <img
                        src={rawGooglePhoto}
                        alt={displayName}
                        className="w-16 h-16 rounded-2xl object-cover border-2 border-cyan-400 shadow-xl"
                      />
                    ) : (
                      <div
                        className={`w-16 h-16 rounded-2xl bg-gradient-to-tr ${selectedAvatarColor} flex items-center justify-center text-xl font-extrabold text-white shadow-xl border-2 border-white/20`}
                      >
                        {displayName ? displayName.substring(0, 2).toUpperCase() : "TV"}
                      </div>
                    )}
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-[#0b0e17] flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Avatar Preview
                    </span>
                    <h4 className="text-base font-bold text-white truncate">
                      {displayName || "Your Name"}
                    </h4>
                    <p className="text-xs text-cyan-400 mt-0.5">
                      {useGooglePhoto && rawGooglePhoto
                        ? "Google Profile Photo"
                        : "Custom Glowing Theme"}
                    </p>
                  </div>
                </div>

                {/* Edit Display Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Enter your display name..."
                    className="w-full px-4 py-3 rounded-2xl bg-slate-900 text-sm text-white placeholder-slate-500 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition"
                    required
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    This name will appear on your TV player dashboard and profile badges.
                  </p>
                </div>

                {/* Avatar Source Selector (Google Photo vs Color Theme) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Avatar Style
                  </label>

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {rawGooglePhoto && (
                      <button
                        type="button"
                        onClick={() => setUseGooglePhoto(true)}
                        className={`p-3 rounded-2xl border text-xs font-semibold flex items-center gap-2.5 transition ${
                          useGooglePhoto
                            ? "bg-cyan-500/15 border-cyan-500 text-cyan-300"
                            : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        <ImageIcon className="w-4 h-4 text-cyan-400" />
                        <span>Use Google Photo</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setUseGooglePhoto(false)}
                      className={`p-3 rounded-2xl border text-xs font-semibold flex items-center gap-2.5 transition ${
                        !useGooglePhoto || !rawGooglePhoto
                          ? "bg-cyan-500/15 border-cyan-500 text-cyan-300"
                          : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white"
                      } ${!rawGooglePhoto ? "col-span-2" : ""}`}
                    >
                      <Palette className="w-4 h-4 text-purple-400" />
                      <span>Custom Color Theme</span>
                    </button>
                  </div>

                  {/* Gradient Color Palette (Shown if Custom Color Theme selected) */}
                  {(!useGooglePhoto || !rawGooglePhoto) && (
                    <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
                      <span className="text-[11px] text-slate-400 font-medium">
                        Select Color Palette:
                      </span>
                      <div className="grid grid-cols-6 gap-2">
                        {AVATAR_COLORS.map((col) => (
                          <button
                            type="button"
                            key={col.name}
                            onClick={() => setSelectedAvatarColor(col.class)}
                            title={col.name}
                            className={`aspect-square rounded-xl bg-gradient-to-tr ${col.class} transition transform ${
                              selectedAvatarColor === col.class
                                ? "ring-2 ring-white ring-offset-2 ring-offset-[#0b0e17] scale-110 shadow-lg"
                                : "opacity-60 hover:opacity-100 hover:scale-105"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Save Changes Button */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSaving || !displayName.trim()}
                    className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-black font-extrabold text-sm shadow-xl shadow-cyan-500/25 transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSaving ? "Saving Changes..." : "Save Changes"}</span>
                  </button>
                </div>
              </form>
            )}

            {/* TAB 2: ACCOUNT OVERVIEW, STATS & DANGER ZONE */}
            {activeTab === "account" && (
              <div className="space-y-5">
                {/* Account Info Card */}
                <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-400">Signed In As</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                        authProvider === "google"
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                          : "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                      }`}
                    >
                      <Cloud className="w-3 h-3" />
                      {authProvider === "google" ? "Google Synced" : "Email Account"}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-white break-all">
                    {supabaseUser.email}
                  </p>
                  {usernameMeta && (
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <AtSign className="w-3 h-3 text-cyan-400" />
                      <span className="font-semibold text-slate-300">{usernameMeta}</span>
                      <span className="text-slate-600">· username</span>
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500">
                    User ID: <span className="font-mono text-[10px]">{supabaseUser.id.substring(0, 16)}...</span>
                  </p>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                      <Heart className="w-5 h-5 fill-current" />
                    </div>
                    <div>
                      <div className="text-lg font-black text-white">
                        {currentProfile.favorites.length}
                      </div>
                      <span className="text-[11px] text-slate-400">Cloud Favorites</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                      <History className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-lg font-black text-white">
                        {currentProfile.history.length}
                      </div>
                      <span className="text-[11px] text-slate-400">Channels Watched</span>
                    </div>
                  </div>
                </div>

                {/* Danger Zone: Clear Favorites */}
                <div className="p-4 rounded-2xl bg-rose-950/20 border border-rose-900/40 space-y-3">
                  <div className="flex items-center gap-2 text-rose-300 text-xs font-bold uppercase tracking-wider">
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                    <span>Data Management</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Remove all saved favorite channels from both Supabase cloud database and your local device.
                  </p>

                  {showClearFavoritesConfirm ? (
                    <div className="p-3 rounded-xl bg-black/60 border border-rose-500/30 space-y-2">
                      <p className="text-xs text-rose-300 font-semibold">
                        Are you sure you want to delete all {currentProfile.favorites.length} favorites?
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleConfirmClearFavorites}
                          disabled={isClearingFavorites}
                          className="flex-1 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition disabled:opacity-50"
                        >
                          {isClearingFavorites ? "Clearing..." : "Yes, Delete All"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowClearFavoritesConfirm(false)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowClearFavoritesConfirm(true)}
                      disabled={currentProfile.favorites.length === 0}
                      className="px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-40 text-rose-300 border border-rose-500/30 text-xs font-semibold transition flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear Cloud Favorites</span>
                    </button>
                  )}
                </div>

                {/* Sign Out Button in Red Gradient */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await signOut();
                      setIsAuthModalOpen(false);
                    }}
                    className="w-full py-3 rounded-2xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white font-bold text-xs shadow-lg shadow-rose-900/30 transition flex items-center justify-center gap-2 active:scale-[0.98]"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out of Account</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* =========================================================================
             SIGNED-OUT VIEW: GOOGLE OAUTH + EMAIL / USERNAME / PASSWORD
             (Guest mode removed — authentication is mandatory)
             ========================================================================= */
          <div className="space-y-5">
            {/* Sign in / Create account segmented control */}
            <div className="flex items-center p-1 rounded-2xl bg-slate-900 border border-slate-800">
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  mode === "signin"
                    ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                  mode === "signup"
                    ? "bg-cyan-500 text-black shadow-md shadow-cyan-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Create Account</span>
              </button>
            </div>

            {/* Google OAuth Button */}
            <button
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
              className="w-full py-3.5 px-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm shadow-xl transition active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-60"
            >
              {/* Google G logo */}
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{isGoogleLoading ? "Connecting to Google..." : "Continue with Google"}</span>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                or {mode === "signup" ? "register with email" : "sign in with email"}
              </span>
              <span className="h-px flex-1 bg-white/10" />
            </div>

            {/* Email / Username / Password form */}
            <form onSubmit={handleEmailSubmit} className="space-y-3.5">
              {mode === "signup" && (
                <div className="relative">
                  <AtSign className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username (shown on your profile)"
                    autoComplete="username"
                    minLength={3}
                    maxLength={30}
                    className={INPUT_CLASS}
                    required
                  />
                </div>
              )}

              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  autoComplete="email"
                  className={INPUT_CLASS}
                  required
                />
              </div>

              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "Password (min. 8 characters)" : "Password"}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={8}
                  className={`${INPUT_CLASS} pr-11`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-500 hover:text-slate-300 transition"
                  title={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={isAuthSubmitting}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-black font-extrabold text-sm shadow-xl shadow-cyan-500/25 transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isAuthSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    <span>{mode === "signup" ? "Creating Account..." : "Signing In..."}</span>
                  </>
                ) : (
                  <>
                    {mode === "signup" ? <UserPlus className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                    <span>{mode === "signup" ? "Create Free Account" : "Sign In"}</span>
                  </>
                )}
              </button>

              {mode === "signup" && (
                <p className="text-[11px] text-slate-500 leading-relaxed text-center">
                  Your username is stored in your Supabase account metadata. By registering you
                  agree to keep this a friendly, free-viewing experience — no card required.
                </p>
              )}
            </form>

            {/* Mode toggle */}
            <div className="pt-3 border-t border-white/10 text-center text-xs text-slate-400">
              {mode === "signup" ? (
                <span>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold inline-flex items-center gap-1"
                  >
                    <span>Sign in</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </span>
              ) : (
                <span>
                  New to StreamPulse?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signup")}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold inline-flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Create a free account</span>
                  </button>
                </span>
              )}
            </div>

            {!isSupabaseActive && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] leading-relaxed">
                <span className="font-semibold">Setup Tip:</span> Save your{" "}
                <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
                <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in{" "}
                <code className="font-mono">.env.local</code> to enable Google + email sign-in.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
