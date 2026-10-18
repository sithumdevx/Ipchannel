"use client";

import React, { useState } from "react";
import { X, User, Sparkles, Check, ArrowRight, ShieldCheck } from "lucide-react";
import { useProfile } from "@/context/ProfileContext";

const AVATAR_COLORS = [
  "from-cyan-500 to-blue-600",
  "from-purple-500 to-indigo-600",
  "from-rose-500 to-pink-600",
  "from-emerald-500 to-teal-700",
  "from-amber-500 to-orange-600",
];

export default function AuthModal() {
  const {
    isAuthModalOpen,
    setIsAuthModalOpen,
    currentProfile,
    profiles,
    loginProfile,
    continueAsGuest,
    switchProfile,
  } = useProfile();

  const [username, setUsername] = useState("");
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0]);

  if (!isAuthModalOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      loginProfile(username, selectedColor);
      setUsername("");
    }
  };

  const userProfiles = profiles.filter((p) => !p.isGuest);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md p-6 sm:p-8 bg-[#0b0e17] border border-white/10 rounded-3xl shadow-2xl overflow-hidden ring-1 ring-cyan-500/20">
        {/* Glow ambient background effect */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={() => setIsAuthModalOpen(false)}
          className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white shadow-lg shadow-cyan-500/30 mb-3">
            <User className="w-6 h-6" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            StreamPulse Profile
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Save your favorite channels and personalized watch history.
          </p>
        </div>

        {/* Profile Switcher if user has saved profiles */}
        {userProfiles.length > 0 && (
          <div className="mb-6 pb-6 border-b border-white/10">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Switch Profile
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {userProfiles.map((p) => {
                const isActive = p.id === currentProfile.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      switchProfile(p.id);
                      setIsAuthModalOpen(false);
                    }}
                    className={`flex flex-col items-center p-3 rounded-2xl border transition ${
                      isActive
                        ? "bg-cyan-500/10 border-cyan-500 text-cyan-300"
                        : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${p.avatarColor} flex items-center justify-center font-bold text-white text-xs mb-1.5 shadow`}
                    >
                      {p.name.substring(0, 2).toUpperCase()}
                    </div>
                    <span className="text-xs font-medium truncate w-full text-center">
                      {p.name}
                    </span>
                    {isActive && (
                      <span className="text-[10px] text-cyan-400 mt-0.5 flex items-center gap-0.5">
                        <Check className="w-3 h-3" /> Active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sign In / Create Profile Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Profile Name / Username
            </label>
            <input
              type="text"
              placeholder="e.g. Alex, SportsFan, CinemaLover..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-900 text-sm text-white placeholder-slate-500 border border-slate-800 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none transition"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-2">
              Choose Avatar Theme
            </label>
            <div className="flex items-center gap-3">
              {AVATAR_COLORS.map((color) => (
                <button
                  type="button"
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${color} transition transform ${
                    selectedColor === color
                      ? "ring-2 ring-white ring-offset-2 ring-offset-[#0b0e17] scale-110"
                      : "opacity-70 hover:opacity-100"
                  }`}
                />
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-sm shadow-lg shadow-cyan-500/25 transition active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4 fill-current" />
            Sign In / Save Profile
          </button>
        </form>

        {/* Guest Access Option */}
        <div className="mt-5 pt-4 border-t border-white/10 text-center">
          <p className="text-xs text-slate-400 mb-2.5">
            Don&apos;t want to create a profile?
          </p>
          <button
            onClick={continueAsGuest}
            className="w-full py-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-800 transition flex items-center justify-center gap-2"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Continue as Guest (Instant Access)
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
