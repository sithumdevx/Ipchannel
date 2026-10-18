"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Tv,
  Play,
  ShieldCheck,
  Zap,
  Globe2,
  Search,
  Heart,
  Radio,
  Sparkles,
  ChevronRight,
  User,
  SlidersHorizontal,
  Flame,
  Newspaper,
  Trophy,
  Film,
  Music2,
  Compass,
  ArrowRight,
  CheckCircle2,
  HelpCircle,
  ExternalLink,
} from "lucide-react";
import { useProfile } from "@/context/ProfileContext";
import { FALLBACK_CHANNELS } from "@/lib/m3u-parser";

// Featured categories for the showcase section
const FEATURED_CATEGORIES = [
  {
    name: "News",
    icon: Newspaper,
    desc: "24/7 breaking worldwide news broadcasts",
    channels: FALLBACK_CHANNELS.filter((c) => c.category === "News" || c.category === "Business").slice(0, 4),
  },
  {
    name: "Sports",
    icon: Trophy,
    desc: "Extreme sports, motorsports, and live athletic events",
    channels: FALLBACK_CHANNELS.filter((c) => c.category === "Sports").concat(
      FALLBACK_CHANNELS.slice(0, 3)
    ).slice(0, 4),
  },
  {
    name: "Movies",
    icon: Film,
    desc: "Action, classic cinema, and indie films round the clock",
    channels: FALLBACK_CHANNELS.filter((c) => c.category === "Movies").concat(
      FALLBACK_CHANNELS.slice(2, 5)
    ).slice(0, 4),
  },
  {
    name: "Science & Nature",
    icon: Compass,
    desc: "Space exploration, wildlife, and technology documentaries",
    channels: FALLBACK_CHANNELS.filter(
      (c) => c.category === "Science" || c.category === "Documentary"
    ).concat(FALLBACK_CHANNELS.slice(0, 2)).slice(0, 4),
  },
];

const FAQS = [
  {
    q: "Is StreamPulse really 100% free to watch?",
    a: "Yes, completely free. There are no subscription fees, credit cards, or hidden paywalls. All channels are legally broadcast free-to-air public streams.",
  },
  {
    q: "Where do the channels originate from?",
    a: "StreamPulse pulls from the iptv-org open-source public repository, aggregating thousands of legal, publicly accessible broadcasts from TV networks worldwide.",
  },
  {
    q: "How does StreamPulse bypass CORS errors and buffering?",
    a: "StreamPulse integrates an optimized Next.js server proxy that handles CORS headers on M3U8 manifests, while video segments load directly from edge CDNs alongside auto adaptive-bitrate level switching.",
  },
  {
    q: "Can I save my favorite channels?",
    a: "Yes! Using our profile system, your favorite channels and recent watch history are safely stored in your browser without requiring a complicated registration process.",
  },
];

export default function LandingPage() {
  const { currentProfile, setIsAuthModalOpen, continueAsGuest } = useProfile();
  const [activeCategoryTab, setActiveCategoryTab] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const activeCategory = FEATURED_CATEGORIES[activeCategoryTab];

  return (
    <div className="min-h-screen flex flex-col bg-[#07080c] text-slate-100 overflow-x-hidden selection:bg-cyan-500 selection:text-black">
      {/* Top Glass Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-40 bg-[#0a0d14]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          {/* Brand Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 group-hover:scale-105 transition-transform">
              <Tv className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                  StreamPulse
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  FREE IPTV
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">
                Live TV Everywhere
              </p>
            </div>
          </Link>

          {/* Nav Links & CTA */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Profile Button */}
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold border border-slate-800 transition"
            >
              {currentProfile.avatarUrl ? (
                <img
                  src={currentProfile.avatarUrl}
                  alt={currentProfile.name}
                  className="w-5 h-5 rounded-lg object-cover border border-cyan-400/40 shadow"
                />
              ) : (
                <div
                  className={`w-5 h-5 rounded-lg bg-gradient-to-tr ${currentProfile.avatarColor} flex items-center justify-center text-[9px] font-bold text-white shadow`}
                >
                  {currentProfile.name.substring(0, 1).toUpperCase()}
                </div>
              )}
              <span className="hidden sm:inline">
                {currentProfile.isGuest ? "Sign In / Profile" : currentProfile.name}
              </span>
            </button>

            {/* Watch Now Button */}
            <Link
              href="/watch"
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-xs sm:text-sm shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition active:scale-95 flex items-center gap-1.5"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Launch Player</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden">
        {/* Glow ambient background orbs */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-cyan-500/15 via-indigo-600/15 to-purple-600/15 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-12 left-10 w-72 h-72 bg-cyan-600/10 rounded-full blur-[90px] pointer-events-none" />
        <div className="absolute top-24 right-10 w-72 h-72 bg-purple-600/10 rounded-full blur-[90px] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto space-y-6">
            {/* Live badge pill */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold backdrop-blur-md shadow-inner">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              <span>Over 30,000+ Legal Broadcast Streams Worldwide</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-black tracking-tight text-white leading-[1.1]">
              Watch Live TV.{" "}
              <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Every Channel.
              </span>{" "}
              100% Free.
            </h1>

            {/* Subtext */}
            <p className="text-base sm:text-lg md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
              Stream world-class news, live sports, movies, documentaries, and kids animation directly in your browser. No subscription, no cable box, no credit card required.
            </p>

            {/* Action Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
              <Link
                href="/watch"
                className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-black font-extrabold text-base shadow-2xl shadow-cyan-500/30 transition transform hover:-translate-y-0.5 active:scale-95 flex items-center justify-center gap-2.5"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>Watch Now — Browse Channels</span>
                <ChevronRight className="w-5 h-5" />
              </Link>

              <button
                onClick={() => {
                  continueAsGuest();
                  window.location.href = "/watch";
                }}
                className="w-full sm:w-auto px-6 py-4 rounded-2xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 text-sm font-semibold border border-slate-800 hover:border-slate-700 backdrop-blur-md transition flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Continue as Guest</span>
              </button>
            </div>

            {/* Quick Badges Under CTA */}
            <div className="pt-4 flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                <span>Zero Subscription Fees</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                <span>Adaptive HLS 1080p Playback</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                <span>Built-in CORS Bypass</span>
              </div>
            </div>
          </div>

          {/* Interactive Player Mockup / Teaser */}
          <div className="mt-14 max-w-5xl mx-auto rounded-3xl p-2 sm:p-3 bg-gradient-to-b from-white/10 via-white/5 to-transparent border border-white/10 shadow-2xl backdrop-blur-xl">
            <div className="relative rounded-2xl overflow-hidden aspect-[16/9] bg-slate-950 border border-slate-800 flex items-center justify-center group">
              {/* Background preview image */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-slate-950/70 to-transparent z-10" />
              
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-900/30 via-slate-950 to-black pointer-events-none" />

              {/* Center Play Button Hero */}
              <Link
                href="/watch"
                className="relative z-20 flex flex-col items-center gap-4 group/play text-center p-6"
              >
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-black shadow-2xl shadow-cyan-500/50 group-hover/play:scale-110 transition duration-300">
                  <Play className="w-10 h-10 sm:w-12 sm:h-12 fill-current ml-1" />
                </div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-bold text-white group-hover/play:text-cyan-300 transition">
                    Click to Open StreamPulse Player
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    Instant access to over 30,000+ legal global streams
                  </p>
                </div>
              </Link>

              {/* Floating sample badges inside hero teaser */}
              <div className="absolute bottom-4 left-4 right-4 z-20 hidden sm:flex items-center justify-between text-xs text-slate-300 bg-black/60 backdrop-blur-md p-3 rounded-xl border border-white/10">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                    LIVE
                  </span>
                  <span className="font-semibold text-white">
                    NASA TV • Red Bull TV • DW News • France 24 • Bloomberg
                  </span>
                </div>
                <div className="flex items-center gap-2 text-cyan-400 font-medium">
                  <span>60s Buffer Optimized</span>
                  <span>•</span>
                  <span>Auto-Bitrate</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Platform Stats Counter Bar */}
      <section className="border-y border-white/5 bg-slate-950/60 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                30,000+
              </div>
              <p className="text-xs sm:text-sm text-slate-400 font-medium">
                Live TV Channels
              </p>
            </div>
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight bg-gradient-to-r from-indigo-400 to-purple-500 bg-clip-text text-transparent">
                150+
              </div>
              <p className="text-xs sm:text-sm text-slate-400 font-medium">
                Countries & Regions
              </p>
            </div>
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent">
                $0 / mo
              </div>
              <p className="text-xs sm:text-sm text-slate-400 font-medium">
                Free Forever
              </p>
            </div>
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight bg-gradient-to-r from-amber-400 to-rose-500 bg-clip-text text-transparent">
                1080p Full HD
              </div>
              <p className="text-xs sm:text-sm text-slate-400 font-medium">
                Adaptive HLS Streams
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Channels Preview by Category */}
      <section className="py-20 md:py-28 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold border border-cyan-500/20 mb-3">
                <Flame className="w-3.5 h-3.5" />
                Featured Channels
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                Explore Popular Categories
              </h2>
              <p className="text-sm text-slate-400 mt-2 max-w-xl">
                Browse hand-picked live channels from sports, news, cinema, and documentaries. Click any card to launch playback instantly.
              </p>
            </div>

            {/* Category tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
              {FEATURED_CATEGORIES.map((cat, idx) => {
                const IconComp = cat.icon;
                const isSelected = activeCategoryTab === idx;
                return (
                  <button
                    key={cat.name}
                    onClick={() => setActiveCategoryTab(idx)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition whitespace-nowrap border ${
                      isSelected
                        ? "bg-cyan-500 text-black border-cyan-400 shadow-lg shadow-cyan-500/25 scale-105"
                        : "bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-800"
                    }`}
                  >
                    <IconComp className="w-4 h-4" />
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Channels Grid for Active Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {activeCategory.channels.map((channel) => (
              <Link
                key={channel.id}
                href={`/watch?channel=${encodeURIComponent(channel.id)}`}
                className="group relative p-4 rounded-3xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 hover:border-cyan-500/50 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-cyan-500/10 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between gap-2 mb-4">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60">
                    {channel.category}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                    LIVE
                  </span>
                </div>

                <div className="relative aspect-video rounded-2xl bg-slate-950/80 border border-white/5 flex items-center justify-center p-4 mb-4 overflow-hidden">
                  {channel.logo ? (
                    <img
                      src={channel.logo}
                      alt={channel.name}
                      className="w-full h-full object-contain filter drop-shadow group-hover:scale-110 transition-transform duration-300"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center font-bold text-white text-sm">
                      {channel.name.substring(0, 2).toUpperCase()}
                    </div>
                  )}

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-cyan-500 text-black flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-bold text-sm text-white group-hover:text-cyan-300 transition line-clamp-1">
                    {channel.name}
                  </h4>
                  <div className="flex items-center justify-between text-xs text-slate-400 mt-1">
                    <span>{channel.country || "Global"}</span>
                    <span className="text-cyan-400 text-[11px] font-medium flex items-center gap-0.5">
                      Play Stream <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="text-center pt-4">
            <Link
              href="/watch"
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-cyan-400 hover:text-cyan-300 transition"
            >
              <span>Explore all {activeCategory.name} channels in player</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 md:py-28 bg-[#0a0d14]/70 border-t border-white/5 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold border border-cyan-500/20">
              <Sparkles className="w-3.5 h-3.5" />
              Engineered For Reliability
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Why Stream on StreamPulse?
            </h2>
            <p className="text-sm text-slate-400">
              Built with modern streaming technology to deliver smooth, uninterrupted live playback across all devices.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/40 transition-all duration-300 hover:shadow-xl space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">
                Optimized HLS Buffer Tuning
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                60-second deep buffer management, background worker decoding, and auto level switching prevent playback stalls even on fluctuating connections.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/40 transition-all duration-300 hover:shadow-xl space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">
                Built-in CORS Bypass Proxy
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Next.js server-side route proxies M3U8 playlists and passes segment chunks directly, bypassing restrictive browser origin headers seamlessly.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/40 transition-all duration-300 hover:shadow-xl space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <Globe2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">
                Global Coverage & Languages
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Channels from over 150 countries in English, Spanish, French, German, Arabic, Hindi, Japanese, and dozens more.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/40 transition-all duration-300 hover:shadow-xl space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                <Search className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">
                Instant Multi-Token Search
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Filter through tens of thousands of channels in real-time. Matches titles, categories, countries, and languages in under 1 millisecond.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/40 transition-all duration-300 hover:shadow-xl space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Heart className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">
                Profile Favorites & History
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Save your favorite channels and track your watch history per profile. Easily switch between family members or continue as a guest.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="p-6 rounded-3xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/40 transition-all duration-300 hover:shadow-xl space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Tv className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">
                Picture-in-Picture & Theater
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Watch in full screen or detach the video into a floating Picture-in-Picture window so you can multitask while watching.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Accordion Section */}
      <section className="py-20 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold border border-cyan-500/20">
            <HelpCircle className="w-3.5 h-3.5" />
            Frequently Asked Questions
          </div>
          <h2 className="text-3xl font-bold text-white tracking-tight">
            Common Inquiries
          </h2>
        </div>

        <div className="space-y-3">
          {FAQS.map((faq, index) => {
            const isOpen = openFaq === index;
            return (
              <div
                key={faq.q}
                className="rounded-2xl bg-slate-900/60 border border-slate-800 overflow-hidden transition"
              >
                <button
                  onClick={() => setOpenFaq(isOpen ? null : index)}
                  className="w-full px-5 py-4 text-left font-semibold text-sm text-white flex items-center justify-between gap-4"
                >
                  <span>{faq.q}</span>
                  <span
                    className={`text-cyan-400 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  >
                    ▼
                  </span>
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 text-xs sm:text-sm text-slate-400 leading-relaxed border-t border-white/5 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Bottom Call to Action Banner */}
      <section className="py-16 bg-gradient-to-t from-slate-950 via-slate-900/90 to-transparent border-t border-white/5">
        <div className="max-w-5xl mx-auto px-4 text-center space-y-6">
          <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
            Ready to Start Streaming?
          </h2>
          <p className="text-slate-400 text-sm sm:text-base max-w-xl mx-auto">
            Join thousands of viewers enjoying legal, free global live TV with zero subscriptions.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/watch"
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-black font-extrabold text-sm sm:text-base shadow-xl shadow-cyan-500/25 transition active:scale-95 flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>Launch Live TV Dashboard</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-slate-950 py-10 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center text-black font-bold">
              <Tv className="w-4 h-4" />
            </div>
            <span className="font-bold text-slate-300">StreamPulse IPTV</span>
            <span>•</span>
            <span>Streams sourced from the open-source iptv-org directory</span>
          </div>

          <div className="flex items-center gap-6 text-slate-400">
            <Link href="/watch" className="hover:text-cyan-400 transition">
              Watch TV
            </Link>
            <a
              href="https://github.com/iptv-org/iptv"
              target="_blank"
              rel="noreferrer"
              className="hover:text-cyan-400 transition flex items-center gap-1"
            >
              <span>iptv-org</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
