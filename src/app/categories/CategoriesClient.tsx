"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  LayoutGrid,
  Play,
  Search,
  Sparkles,
  Tv,
  Users,
  X,
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import AdminDashboardLink from "@/components/AdminDashboardLink";
import { useProfile } from "@/context/ProfileContext";
import { categoryTheme } from "@/lib/category-theme";
import { FALLBACK_CHANNELS } from "@/lib/m3u-parser";
import { Channel, ChannelsApiResponse } from "@/types/iptv";

interface CategoryStat {
  name: string;
  total: number;
  /** Channels confirmed reachable by the stream verifier. */
  live: number;
  /** Up to 3 representative channel logos for the card collage. */
  samples: string[];
}

/** Group channels into per-category stats, biggest categories first. */
function buildStats(channels: Channel[]): CategoryStat[] {
  const byCategory = new Map<string, CategoryStat>();

  for (const channel of channels) {
    const name = channel.category?.trim() || "General";
    const key = name.toLowerCase();
    const entry = byCategory.get(key) ?? { name, total: 0, live: 0, samples: [] };
    entry.total += 1;
    if (channel.isLive === true) entry.live += 1;
    if (channel.logo && entry.samples.length < 3) entry.samples.push(channel.logo);
    byCategory.set(key, entry);
  }

  return Array.from(byCategory.values()).sort((a, b) => b.total - a.total);
}

export default function CategoriesClient() {
  const router = useRouter();
  const { supabaseUser, openAuthModal } = useProfile();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [query, setQuery] = useState<string>("");

  /** Category the visitor tapped before signing in — resumed after auth. */
  const pendingCategoryRef = useRef<string | null>(null);

  /**
   * Fetch the full channel catalogue once on mount. Uses promise callbacks so
   * state updates land asynchronously (react-hooks/set-state-in-effect).
   */
  useEffect(() => {
    let cancelled = false;

    fetch("/api/channels?all=true")
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json() as Promise<ChannelsApiResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        if (data.channels && data.channels.length > 0) {
          setChannels(data.channels);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("Could not load channel catalogue for categories", err);
        setChannels((prev) => (prev.length > 0 ? prev : FALLBACK_CHANNELS));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Resume the interrupted navigation: if the visitor tapped a category card
   * while signed out, the auth modal opens — and on successful sign-in we jump
   * straight into the filtered player instead of leaving them stranded here.
   */
  useEffect(() => {
    if (!supabaseUser || !pendingCategoryRef.current) return;
    const category = pendingCategoryRef.current;
    pendingCategoryRef.current = null;
    router.replace(`/watch?category=${encodeURIComponent(category)}`);
  }, [supabaseUser, router]);

  const stats = useMemo(() => buildStats(channels), [channels]);
  const totalChannels = useMemo(
    () => stats.reduce((sum, s) => sum + s.total, 0),
    [stats]
  );
  const totalLive = useMemo(
    () => stats.reduce((sum, s) => sum + s.live, 0),
    [stats]
  );

  const filteredStats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stats;
    return stats.filter((s) => s.name.toLowerCase().includes(q));
  }, [stats, query]);

  /** Open a category: instant jump for members, auth modal for visitors. */
  const openCategory = (name: string) => {
    if (supabaseUser) {
      router.push(`/watch?category=${encodeURIComponent(name)}`);
    } else {
      pendingCategoryRef.current = name;
      openAuthModal("signin");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-app text-ink selection:bg-cyan-500 selection:text-black">
      {/* ============================ TOP GLASS NAV ============================ */}
      <header className="sticky top-0 z-40 bg-panel/80 backdrop-blur-xl border-b border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 flex-shrink-0" title="Home">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
              <Tv className="w-4 h-4 text-white" />
            </div>
            <span className="font-extrabold text-base sm:text-lg tracking-tight bg-gradient-to-r from-ink via-ink to-dim bg-clip-text text-transparent hidden sm:inline">
              StreamPulse
            </span>
          </Link>

          {/* Center links (desktop) */}
          <nav className="hidden md:flex items-center gap-1 p-1 rounded-2xl bg-glass border border-line2 text-xs font-semibold">
            <Link
              href="/"
              className="px-3.5 py-2 rounded-xl text-dim hover:text-ink hover:bg-glass2 transition"
            >
              Home
            </Link>
            <span className="px-3.5 py-2 rounded-xl bg-cyan-500 text-black font-bold shadow-lg shadow-cyan-500/25">
              Categories
            </span>
            <Link
              href="/watch"
              className="px-3.5 py-2 rounded-xl text-dim hover:text-ink hover:bg-glass2 transition"
            >
              Watch TV
            </Link>
            <Link
              href="/developer"
              className="px-3.5 py-2 rounded-xl text-dim hover:text-ink hover:bg-glass2 transition"
              title="Developed by Sithum Thilina"
            >
              Developer
            </Link>
            {/* Administrators only — renders nothing for ordinary members. */}
            <AdminDashboardLink
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 transition"
              label="Admin"
            />
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <ThemeToggle />
            <Link
              href="/watch"
              className="flex items-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-xs sm:text-sm shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition active:scale-95"
            >
              <Play className="w-4 h-4 fill-current" />
              <span className="hidden xs:inline sm:inline">Watch Now</span>
            </Link>
          </div>
        </div>

        {/* Mobile nav row */}
        <nav className="md:hidden flex items-center gap-2 overflow-x-auto px-4 pb-2.5 scrollbar-none border-t border-line/60 pt-2.5">
          {[
            { label: "Home", href: "/", active: false },
            { label: "Categories", href: "/categories", active: true },
            { label: "Watch TV", href: "/watch", active: false },
            { label: "Developer", href: "/developer", active: false },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition ${
                item.active
                  ? "bg-cyan-500 text-black border-cyan-400 shadow-lg shadow-cyan-500/25"
                  : "bg-chip text-dim border-line hover:text-ink hover:border-line2"
              }`}
            >
              {item.label}
            </Link>
          ))}
            {/* Appended outside the literal so the item can vanish entirely for
                non-admins rather than leaving an empty pill. */}
            <AdminDashboardLink
              className="px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20"
              label="Admin"
            />
        </nav>
      </header>

      {/* ============================== HERO ================================= */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[680px] h-[420px] bg-gradient-to-tr from-cyan-500/15 via-indigo-600/15 to-purple-600/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-600 dark:text-cyan-300 text-xs font-semibold backdrop-blur-md">
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Every genre, one tap away</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
            Browse{" "}
            <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              Channel Categories
            </span>
          </h1>

          <p className="text-sm sm:text-base text-dim max-w-2xl mx-auto leading-relaxed">
            Pick a category below and the player opens instantly with every live
            channel in that genre — news, sports, movies, kids and dozens more.
          </p>

          {/* Live stats */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-xs font-bold">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 animate-live-ring" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              </span>
              {totalLive.toLocaleString()} live now
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-chip border border-line text-dim text-xs font-semibold">
              <Tv className="w-3.5 h-3.5 text-cyan-400" />
              {totalChannels.toLocaleString()} channels
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-chip border border-line text-dim text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              {stats.length.toLocaleString()} categories
            </span>
          </div>

          {/* Search categories */}
          <div className="max-w-md mx-auto pt-3 relative">
            <Search className="w-4 h-4 text-dim absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter categories…"
              className="w-full pl-10 pr-10 py-3 rounded-2xl bg-chip text-sm text-ink placeholder-faint border border-line focus:border-cyan-500/80 focus:ring-2 focus:ring-cyan-500/20 outline-none transition"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-ink p-1"
                aria-label="Clear category search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ============================ CATEGORY GRID =========================== */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        {isLoading && stats.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-3xl bg-chip border border-line h-44 sm:h-48"
              />
            ))}
          </div>
        ) : filteredStats.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center bg-card/60 rounded-3xl border border-dashed border-line2 p-8">
            <div className="w-16 h-16 rounded-2xl bg-glass2 flex items-center justify-center mb-4 text-dim">
              <Search className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-ink">No categories found</h3>
            <p className="text-sm text-dim max-w-sm mt-1 mb-6">
              Nothing matches “{query}”. Try a different keyword.
            </p>
            <button
              onClick={() => setQuery("")}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-lg shadow-cyan-600/30 transition"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
            {/* All Channels mega card */}
            {query.trim() === "" && (
              <button
                type="button"
                onClick={() => openCategory("All")}
                className="group relative text-left rounded-3xl overflow-hidden min-h-[180px] sm:min-h-[200px] bg-gradient-to-br from-cyan-500 via-indigo-600 to-purple-700 p-5 sm:p-6 shadow-xl shadow-cyan-500/10 hover:shadow-2xl hover:shadow-cyan-500/20 hover:-translate-y-1.5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_60%)] pointer-events-none" />
                <div className="relative flex flex-col h-full min-h-[140px] justify-between">
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-white/20 border border-white/30 backdrop-blur-md flex items-center justify-center text-white">
                      <Tv className="w-6 h-6" />
                    </div>
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/25 border border-white/20 text-white text-[10px] font-black tracking-wider backdrop-blur-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      LIVE TV
                    </span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-extrabold text-white tracking-tight">
                      All Channels
                    </h2>
                    <p className="text-xs text-white/80 mt-1">
                      Skip the filter — open the full live grid (
                      {totalChannels.toLocaleString()} channels).
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-white group-hover:gap-2.5 transition-all">
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Open the player</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </button>
            )}

            {/* Category cards */}
            {filteredStats.map((stat) => {
              const theme = categoryTheme(stat.name);
              const Icon = theme.icon;
              return (
                <button
                  key={stat.name.toLowerCase()}
                  type="button"
                  onClick={() => openCategory(stat.name)}
                  title={`Watch ${stat.name} channels`}
                  className="group relative text-left rounded-3xl overflow-hidden min-h-[180px] sm:min-h-[200px] p-5 sm:p-6 shadow-xl shadow-shadow/40 hover:-translate-y-1.5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                >
                  {/* Gradient backdrop */}
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${theme.gradient} transition-transform duration-500 group-hover:scale-[1.04]`}
                  />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.22),transparent_55%)] pointer-events-none" />
                  <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors duration-300" />

                  <div className="relative flex flex-col h-full min-h-[140px] justify-between">
                    <div className="flex items-start justify-between gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-white/15 border border-white/25 backdrop-blur-md flex items-center justify-center text-white shadow-lg">
                        <Icon className="w-6 h-6" />
                      </div>
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/25 border border-white/20 text-white text-[10px] font-black tracking-wider backdrop-blur-sm whitespace-nowrap">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                        {stat.live > 0 ? `${stat.live.toLocaleString()} LIVE` : "ON DEMAND"}
                      </span>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 min-w-0">
                        <h2 className="text-xl font-extrabold text-white tracking-tight truncate">
                          {stat.name}
                        </h2>
                        {stat.samples.length > 0 && (
                          <span className="hidden sm:flex items-center -space-x-2 flex-shrink-0">
                            {stat.samples.map((logo, i) => (
                              <img
                                key={`${stat.name}-logo-${i}`}
                                src={logo}
                                alt=""
                                aria-hidden
                                loading="lazy"
                                className="w-6 h-6 rounded-full bg-white/90 object-contain p-0.5 border border-white/60"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ))}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/80 mt-1 line-clamp-1">{theme.tagline}</p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white/90">
                          <Users className="w-3.5 h-3.5" />
                          {stat.total.toLocaleString()} channel{stat.total === 1 ? "" : "s"}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-white group-hover:gap-2 transition-all">
                          <span className="hidden sm:inline">Watch</span>
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Membership hint */}
        <div className="mt-10 sm:mt-12 rounded-3xl bg-card/70 border border-line2 p-6 sm:p-8 text-center space-y-3 backdrop-blur-xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-600 dark:text-cyan-300 text-[11px] font-semibold">
            <Sparkles className="w-3 h-3" />
            Free account · takes under a minute
          </div>
          <h3 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            Watching is members-only
          </h3>
          <p className="text-sm text-dim max-w-xl mx-auto">
            Every category opens straight into the player with cloud-synced
            favorites and watch history — create a free account (or sign in) to
            start streaming.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <Link
              href="/watch"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-black font-extrabold text-sm shadow-xl shadow-cyan-500/25 transition active:scale-95"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Open Live TV</span>
            </Link>
            <button
              type="button"
              onClick={() => openAuthModal("signin")}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-glass hover:bg-glass2 text-ink font-bold text-sm border border-line2 transition active:scale-95"
            >
              <Users className="w-4 h-4 text-cyan-400" />
              <span>Sign in</span>
            </button>
          </div>
        </div>
      </main>

      {/* =============================== FOOTER =============================== */}
      <footer className="border-t border-line bg-panel/80 py-8 text-xs text-dim mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white">
              <Tv className="w-4 h-4" />
            </div>
            <span className="font-bold text-ink">StreamPulse IPTV</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/" className="hover:text-cyan-400 transition font-semibold">
              Home
            </Link>
            <Link href="/watch" className="hover:text-cyan-400 transition font-semibold">
              Watch TV
            </Link>
            <Link href="/categories" className="text-cyan-400 font-semibold">
              Categories
            </Link>
            <Link href="/developer" className="hover:text-cyan-400 transition">
              Developer
            </Link>
            {/* Administrators only — renders nothing for ordinary members. */}
            <AdminDashboardLink
              className="hover:text-amber-400 transition font-semibold text-amber-300/90"
              label="Admin Console"
            />
          </div>
        </div>
      </footer>
    </div>
  );
}
