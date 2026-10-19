"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Tv,
  Play,
  Search,
  ShieldCheck,
  Zap,
  Globe2,
  Heart,
  Radio,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  UserPlus,
  Lock,
  Flame,
  Newspaper,
  Trophy,
  Film,
  Music2,
  Compass,
  ArrowRight,
  CheckCircle2,
  HelpCircle,
  Baby,
  Popcorn,
} from "lucide-react";
import { useProfile } from "@/context/ProfileContext";
import { FALLBACK_CHANNELS } from "@/lib/m3u-parser";
import { Channel, ChannelsApiResponse } from "@/types/iptv";
import ThemeToggle from "@/components/ThemeToggle";
import AdminDashboardLink from "@/components/AdminDashboardLink";
import CountryFilter from "@/components/CountryFilter";
import { countryFlag, countryLabel, matchesCountry } from "@/lib/countries";
import { cleanChannelTitle } from "@/lib/channel-display";

type IconType = React.ComponentType<{ className?: string }>;

interface BrowseSpec {
  id: string;
  label: string;
  api: string | null;
  icon: IconType;
  tagline?: string;
}

/** Carousel rows — each one is a horizontal, snap-scrolling channel rail. */
const CAROUSELS: BrowseSpec[] = [
  {
    id: "news",
    label: "Live News",
    api: "News",
    icon: Newspaper,
    tagline: "24/7 breaking news from around the world",
  },
  {
    id: "sports",
    label: "Sports",
    api: "Sports",
    icon: Trophy,
    tagline: "Live matches, motorsports and extreme events",
  },
  {
    id: "entertainment",
    label: "Entertainment",
    api: "Entertainment",
    icon: Popcorn,
    tagline: "Showbiz, reality and general entertainment",
  },
  {
    id: "movies",
    label: "Movies",
    api: "Movies",
    icon: Film,
    tagline: "Cinema, action marathons and cult classics",
  },
];

/** Quick-filter chips for the browse grid. `api: null` = curated mix. */
const CHIPS: BrowseSpec[] = [
  { id: "trending", label: "Trending", api: null, icon: Flame },
  { id: "news", label: "Live News", api: "News", icon: Newspaper },
  { id: "sports", label: "Sports", api: "Sports", icon: Trophy },
  { id: "entertainment", label: "Entertainment", api: "Entertainment", icon: Popcorn },
  { id: "movies", label: "Movies", api: "Movies", icon: Film },
  { id: "kids", label: "Kids", api: "Kids", icon: Baby },
  { id: "music", label: "Music", api: "Music", icon: Music2 },
  { id: "documentary", label: "Documentary", api: "Documentary", icon: Compass },
];

const BOOTSTRAP_CATEGORIES = ["News", "Sports", "Entertainment", "Movies"];

const FEATURES: { icon: IconType; title: string; body: string; tint: string }[] = [
  {
    icon: Zap,
    title: "Optimized HLS Buffer Tuning",
    body: "60-second deep buffer management, background worker decoding, and auto level switching prevent playback stalls even on fluctuating connections.",
    tint: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  },
  {
    icon: ShieldCheck,
    title: "Built-in CORS Bypass Proxy",
    body: "A hardened Next.js route proxies M3U8 playlists and passes segments straight from the edge CDN, bypassing restrictive browser origin headers.",
    tint: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
  },
  {
    icon: Globe2,
    title: "Global Coverage & Languages",
    body: "Channels from over 150 countries in English, Spanish, French, German, Arabic, Hindi, Japanese, and dozens more.",
    tint: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  },
  {
    icon: Search,
    title: "Instant Multi-Token Search",
    body: "Filter through tens of thousands of channels in real time — titles, categories, countries and languages match in under a millisecond.",
    tint: "text-rose-400 bg-rose-500/10 border-rose-500/20",
  },
  {
    icon: Heart,
    title: "Cloud Favorites & History",
    body: "Sign in once and your favorite channels plus watch history follow you across every device, synced through Supabase.",
    tint: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  {
    icon: Tv,
    title: "Picture-in-Picture & Theater",
    body: "Watch in full screen or detach the video into a floating Picture-in-Picture window so you can multitask while watching.",
    tint: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
];

const FAQS = [
  {
    q: "Is StreamPulse really 100% free to watch?",
    a: "Yes, completely free. There are no subscription fees, credit cards, or hidden paywalls — all channels are legally broadcast free-to-air public streams.",
  },
  {
    q: "Why do I need an account?",
    a: "StreamPulse is account-only: one free signup (Google or email + username) unlocks the player and keeps your favorites and watch history synced in the cloud. There is no guest mode anymore, and registration never requires a card.",
  },
  {
    q: "Where do the channels originate?",
    a: "StreamPulse aggregates thousands of legal, publicly accessible broadcasts from TV networks worldwide through its own curated channel directory.",
  },
  {
    q: "How does StreamPulse bypass CORS errors and buffering?",
    a: "StreamPulse integrates an optimized Next.js server proxy that handles CORS headers on M3U8 manifests, while video segments load directly from edge CDNs alongside adaptive-bitrate level switching.",
  },
];

/** Server-side category names may differ in casing; build a rich fallback. */
function fallbackFor(apiCategory: string): Channel[] {
  const exact = FALLBACK_CHANNELS.filter(
    (c) => c.category.toLowerCase() === apiCategory.toLowerCase()
  );
  if (exact.length >= 6) return exact;
  const rest = FALLBACK_CHANNELS.filter((c) => c.category !== apiCategory);
  return [...exact, ...rest].slice(0, 8);
}

/** Country-aware fallback so a filtered rail never shows other regions. */
function fallbackForCountry(apiCategory: string, country: string): Channel[] {
  if (country === "All") return fallbackFor(apiCategory);

  const sameCountry = FALLBACK_CHANNELS.filter((c) => matchesCountry(c.country, country));
  if (sameCountry.length === 0) return [];
  const exact = sameCountry.filter(
    (c) => c.category.toLowerCase() === apiCategory.toLowerCase()
  );
  const rest = sameCountry.filter(
    (c) => c.category.toLowerCase() !== apiCategory.toLowerCase()
  );
  return [...exact, ...rest].slice(0, 8);
}

/**
 * Catalog cache key — one entry per category *and* country so switching the
 * country bar swaps the whole rail instantly without refetching.
 */
function catalogKey(apiCategory: string, country: string): string {
  return country === "All" ? apiCategory : `${apiCategory}::${country}`;
}

function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "TV"
  );
}

/* -------------------------------------------------------------------------- */
/*  Channel tile — used by the browse grid and every carousel                  */
/* -------------------------------------------------------------------------- */
function ChannelTile({
  channel,
  className = "",
}: {
  channel: Channel;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <Link
      href={`/watch?channel=${encodeURIComponent(channel.id)}`}
      className={`group relative flex flex-col rounded-2xl overflow-hidden bg-slate-900/60 hover:bg-slate-800/70 border border-white/5 hover:border-cyan-500/40 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-cyan-500/10 ${className}`}
    >
      {/* Media area */}
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.16),transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {channel.logo && !imgError ? (
          <img
            src={channel.logo}
            alt={channel.name}
            loading="lazy"
            onError={() => setImgError(true)}
            className="relative max-h-full max-w-full object-contain drop-shadow-lg group-hover:scale-110 transition-transform duration-300"
          />
        ) : (
          <div className="relative w-12 h-12 rounded-xl bg-gradient-to-tr from-cyan-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center font-extrabold text-slate-200 text-sm">
            {initialsOf(channel.name)}
          </div>
        )}

        {/* LIVE status badge */}
        <span className="absolute top-2.5 left-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/90 border border-rose-400/40 text-white text-[9px] font-black tracking-wider backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          LIVE
        </span>

        {/* Category chip */}
        <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-black/55 border border-white/10 text-[9px] font-bold text-slate-300 backdrop-blur-sm max-w-[45%] truncate">
          {channel.category || "General"}
        </span>

        {/* Hover play overlay */}
        <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
          <span className="w-11 h-11 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-600 text-black flex items-center justify-center shadow-xl shadow-cyan-500/40 group-hover:scale-110 transition-transform duration-200">
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </span>
        </div>
      </div>

      {/* Info bar */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-3">
        <div className="min-w-0">
          <h4 className="font-bold text-[13px] leading-tight text-white truncate group-hover:text-cyan-300 transition">
            {cleanChannelTitle(channel.name)}
          </h4>
          <p className="text-[11px] text-slate-500 truncate mt-0.5">
            {channel.country
              ? `${countryFlag(channel.country)} ${countryLabel(channel.country)}`
              : "🌐 Global"}
            {channel.language ? ` · ${channel.language}` : ""}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 flex-shrink-0 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition" />
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  Skeleton loader for a rail / grid                                           */
/* -------------------------------------------------------------------------- */
function TileSkeletons({ count, className = "" }: { count: number; className?: string }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`rounded-2xl bg-slate-900/50 border border-white/5 overflow-hidden animate-pulse ${className}`}
        >
          <div className="aspect-video bg-slate-800/60" />
          <div className="p-3.5 space-y-2">
            <div className="h-3 bg-slate-800/70 rounded w-3/4" />
            <div className="h-2.5 bg-slate-800/50 rounded w-1/2" />
          </div>
        </div>
      ))}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Category carousel row                                                      */
/* -------------------------------------------------------------------------- */
function CategoryRow({
  spec,
  channels,
  loading,
  country = "All",
}: {
  spec: BrowseSpec;
  channels: Channel[];
  loading: boolean;
  country?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const Icon = spec.icon;

  const seeAllHref = (() => {
    const query = new URLSearchParams({ category: spec.api || "All" });
    if (country !== "All") query.set("country", country);
    return `/watch?${query.toString()}`;
  })();

  const nudge = (dir: number) => {
    scrollerRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  };

  return (
    <section className="space-y-4">
      {/* Row header */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500/15 to-purple-500/15 border border-white/10 flex items-center justify-center text-cyan-300 flex-shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <span className="truncate">{spec.label}</span>
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[9px] font-black tracking-wider flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                LIVE
              </span>
            </h3>
            {spec.tagline && (
              <p className="text-xs text-slate-500 truncate">{spec.tagline}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => nudge(-1)}
            className="hidden sm:flex p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition"
            title={`Scroll ${spec.label} left`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => nudge(1)}
            className="hidden sm:flex p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition"
            title={`Scroll ${spec.label} right`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <Link
            href={seeAllHref}
            className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition pl-1"
          >
            <span>See all</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Rail */}
      <div
        ref={scrollerRef}
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 scrollbar-none"
      >
        {loading ? (
          <TileSkeletons count={6} className="min-w-[236px] sm:min-w-[256px] shrink-0" />
        ) : channels.length > 0 ? (
          channels.map((channel) => (
            <ChannelTile
              key={`${spec.id}-${channel.id}`}
              channel={channel}
              className="min-w-[236px] sm:min-w-[256px] shrink-0 snap-start"
            />
          ))
        ) : (
          <div className="w-full py-8 text-center text-xs text-slate-500 rounded-2xl border border-dashed border-white/10">
            No channels loaded for this category yet.
          </div>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Home                                                                       */
/* -------------------------------------------------------------------------- */
export default function LandingPage() {
  const { currentProfile, supabaseUser, isSupabaseActive, openAuthModal } = useProfile();

  const [catalog, setCatalog] = useState<Record<string, Channel[]>>({});
  const [countries, setCountries] = useState<string[]>([]);
  const [activeChip, setActiveChip] = useState(0);
  const [selectedCountry, setSelectedCountry] = useState("All");
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  /**
   * Fetch (and cache) one category of channels from the API, scoped to the
   * active country filter.
   *
   * A category counts as "loading" simply by being absent from `catalog`, so no
   * separate loading state is needed (and none is set synchronously from the
   * bootstrap effects below). An in-flight set dedupes concurrent requests.
   * Cache keys include the country so switching the country bar swaps rails
   * instantly without refetching.
   */
  const inFlight = useRef<Set<string>>(new Set());
  const requestGeneration = useRef<Map<string, number>>(new Map());
  const loadCategory = useCallback(
    async (apiCategory: string, country: string = selectedCountry) => {
      const key = catalogKey(apiCategory, country);
      if (catalog[key] || inFlight.current.has(key)) return;
      inFlight.current.add(key);
      const generation = (requestGeneration.current.get(key) ?? 0) + 1;
      requestGeneration.current.set(key, generation);
      try {
        const params = new URLSearchParams({ category: apiCategory, limit: "12" });
        if (country !== "All") params.set("country", country);
        const res = await fetch(`/api/channels?${params.toString()}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data: ChannelsApiResponse = await res.json();
        const channels =
          data.channels && data.channels.length > 0
            ? data.channels
            : fallbackForCountry(apiCategory, country);
        if (data.countries && data.countries.length > 0) {
          setCountries((prev) => {
            const merged = new Set([...prev, ...data.countries]);
            return merged.size > prev.length ? Array.from(merged) : prev;
          });
        }
        if (requestGeneration.current.get(key) === generation) {
          setCatalog((prev) => ({ ...prev, [key]: channels }));
        }
      } catch (err) {
        console.warn(`Could not load ${apiCategory} channels`, err);
        if (requestGeneration.current.get(key) === generation) {
          setCatalog((prev) => ({ ...prev, [key]: fallbackForCountry(apiCategory, country) }));
        }
      } finally {
        inFlight.current.delete(key);
      }
    },
    [catalog, selectedCountry]
  );

  // Bootstrap the four carousel rows once on mount.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    BOOTSTRAP_CATEGORIES.forEach((cat) => {
      void loadCategory(cat);
    });
  }, [loadCategory]);

  const activeChipSpec = CHIPS[activeChip] ?? CHIPS[0];

  /**
   * The edge proxy bounces unauthenticated `/watch` visitors to `/?login=true`
   * (legacy links used `/?signin=1`). Honour both here by opening the auth
   * modal immediately, so the redirect lands the user on the login screen
   * rather than a passive landing page.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requestedAuth =
      params.get("login") === "true" || params.get("signin") === "1";
    if (!requestedAuth) return;
    openAuthModal("signin");
    // Remove the param from the URL so a refresh doesn't re-trigger the modal.
    params.delete("login");
    params.delete("signin");
    const next = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", next);
  }, [openAuthModal]);

  /** Chip selection: swap the grid and lazily fetch any uncached category. */
  const selectChip = (idx: number) => {
    setActiveChip(idx);
    const spec = CHIPS[idx];
    if (spec.api) void loadCategory(spec.api, selectedCountry);
  };

  /** Re-fetch every rail + the active chip when the country bar changes. */
  useEffect(() => {
    const apis = [
      ...CAROUSELS.map((spec) => spec.api),
      (CHIPS[activeChip] ?? CHIPS[0]).api,
    ];
    apis.forEach((api) => {
      if (api) void loadCategory(api, selectedCountry);
    });
  }, [selectedCountry, activeChip, loadCategory]);

  // Grid contents for the active chip (country-filtered instantly).
  const gridChannels = useMemo(() => {
    let list: Channel[];

    if (!activeChipSpec.api) {
      const mixed = BOOTSTRAP_CATEGORIES.flatMap((cat) =>
        (catalog[catalogKey(cat, selectedCountry)] || []).slice(0, 3)
      );
      list =
        mixed.length > 0
          ? mixed
          : FALLBACK_CHANNELS.filter((c) => matchesCountry(c.country, selectedCountry));
    } else {
      list =
        catalog[catalogKey(activeChipSpec.api, selectedCountry)] ||
        fallbackForCountry(activeChipSpec.api, selectedCountry);
    }

    return selectedCountry === "All"
      ? list
      : list.filter((ch) => matchesCountry(ch.country, selectedCountry));
  }, [activeChipSpec, catalog, selectedCountry]);

  /** Deep link helper — keeps the active country in every `/watch` jump. */
  const watchHref = (params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params);
    if (selectedCountry !== "All") query.set("country", selectedCountry);
    const qs = query.toString();
    return qs ? `/watch?${qs}` : "/watch";
  };

  // Dynamic hero spotlight: rotates through loaded channels.
  const featuredPool = useMemo(() => {
    const pool = [
      ...(catalog[catalogKey("Sports", selectedCountry)] || []).slice(0, 2),
      ...(catalog[catalogKey("News", selectedCountry)] || []).slice(0, 3),
      ...(catalog[catalogKey("Movies", selectedCountry)] || []).slice(0, 2),
      ...(catalog[catalogKey("Entertainment", selectedCountry)] || []).slice(0, 2),
    ];
    return pool.length > 0
      ? pool.slice(0, 7)
      : FALLBACK_CHANNELS.filter((c) => matchesCountry(c.country, selectedCountry)).slice(0, 7);
  }, [catalog, selectedCountry]);

  useEffect(() => {
    if (featuredPool.length < 2) return;
    const timer = setInterval(() => {
      setFeaturedIndex((i) => (i + 1) % featuredPool.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [featuredPool.length]);

  const featured = featuredPool[featuredIndex % featuredPool.length] ?? FALLBACK_CHANNELS[0];

  /** Primary CTA — authenticated users go straight in, others get the modal. */
  const watchCta = (className: string, label: React.ReactNode) =>
    supabaseUser ? (
      <Link href={watchHref()} className={className}>
        {label}
      </Link>
    ) : (
      <button type="button" onClick={() => openAuthModal("signin")} className={className}>
        {label}
      </button>
    );

  return (
    <div className="min-h-screen flex flex-col bg-[#07080c] text-slate-100 overflow-x-hidden selection:bg-cyan-500 selection:text-black">
      {/* ============================= TOP GLASS NAV ============================= */}
      <nav className="fixed top-0 left-0 right-0 z-40 bg-panel/75 backdrop-blur-xl border-b border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-3">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 group-hover:scale-105 transition-transform">
              <Tv className="w-5 h-5 text-white" />
            </div>
            <div className="hidden sm:block">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-ink via-ink to-dim bg-clip-text text-transparent">
                  StreamPulse
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500/10 text-cyan-500 dark:text-cyan-400 border border-cyan-500/30">
                  FREE
                </span>
              </div>
              <p className="text-[10px] text-faint font-medium -mt-0.5">Live TV Everywhere</p>
            </div>
          </Link>

          {/* Center links */}
          <div className="hidden md:flex items-center gap-1 p-1 rounded-2xl bg-glass border border-line2 backdrop-blur-md text-xs font-semibold">
            <a href="#browse" className="px-3.5 py-2 rounded-xl text-ink bg-glass2 transition">
              Browse
            </a>
            <Link
              href="/categories"
              className="px-3.5 py-2 rounded-xl text-dim hover:text-ink hover:bg-glass transition"
            >
              Categories
            </Link>
            <Link
              href="/developer"
              className="px-3.5 py-2 rounded-xl text-dim hover:text-ink hover:bg-glass transition"
              title="Developed by Sithum Thilina"
            >
              Developer
            </Link>
            {/* Administrators only — renders nothing for ordinary members. */}
            <AdminDashboardLink
              className="px-3.5 py-2 rounded-xl text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 transition"
              label="Admin"
            />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            <ThemeToggle />

            <Link
              href={watchHref()}
              className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-glass hover:bg-glass2 border border-line text-dim hover:text-ink text-xs font-medium transition"
              title="Search 30,000+ channels"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Search channels</span>
            </Link>

            <button
              type="button"
              onClick={() => openAuthModal("signin")}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-chip hover:bg-glass2 text-ink text-xs font-semibold border border-line transition"
              title={supabaseUser ? "Open profile settings" : "Sign in"}
            >
              {currentProfile.avatarUrl ? (
                <img
                  src={currentProfile.avatarUrl}
                  alt={currentProfile.name}
                  className="w-6 h-6 rounded-lg object-cover border border-cyan-400/40 shadow"
                />
              ) : (
                <div
                  className={`w-6 h-6 rounded-lg bg-gradient-to-tr ${currentProfile.avatarColor} flex items-center justify-center text-[10px] font-bold text-white shadow`}
                >
                  {(supabaseUser ? currentProfile.name : "S").substring(0, 1).toUpperCase()}
                </div>
              )}
              <span className="hidden sm:inline max-w-[110px] truncate">
                {supabaseUser ? currentProfile.name : "Sign In"}
              </span>
            </button>

            {watchCta(
              "px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-bold text-xs sm:text-sm shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition active:scale-95 flex items-center gap-1.5",
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Watch Now</span>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ================================ HERO ================================= */}
      <section className="relative pt-24 sm:pt-32 pb-14 md:pb-20 overflow-hidden">
        {/* Cinematic aurora background */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[860px] h-[640px] bg-gradient-to-tr from-cyan-500/20 via-indigo-600/15 to-purple-600/20 rounded-full blur-[140px] animate-aurora pointer-events-none" />
        <div className="absolute top-40 -left-24 w-80 h-80 bg-cyan-600/12 rounded-full blur-[100px] animate-aurora pointer-events-none" />
        <div className="absolute top-28 -right-20 w-96 h-96 bg-purple-600/15 rounded-full blur-[110px] animate-aurora pointer-events-none" />
        {/* Faint broadcast grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)] pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-14 items-center">
            {/* -------- Left: copy + CTAs -------- */}
            <div className="text-center lg:text-left space-y-6">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold backdrop-blur-md">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                <Radio className="w-3.5 h-3.5" />
                <span>30,000+ legal broadcast streams worldwide</span>
              </div>

              <h1 className="text-4xl sm:text-5xl xl:text-6xl font-black tracking-tight text-white leading-[1.08]">
                Your next channel is{" "}
                <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                  one click away
                </span>
                .
              </h1>

              <p className="text-base sm:text-lg text-slate-300 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                News, live sports, movies and entertainment from every continent — streamed in
                adaptive 1080p straight from your browser. Free forever, no cable box, no card.
              </p>

              {/* Gradient CTAs */}
              <div className="pt-1 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
                {watchCta(
                  "w-full sm:w-auto px-7 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-black font-extrabold text-sm shadow-2xl shadow-cyan-500/30 transition transform hover:-translate-y-0.5 active:scale-95 flex items-center justify-center gap-2.5",
                  <>
                    <Play className="w-5 h-5 fill-current" />
                    <span>{supabaseUser ? "Watch Now" : "Start Watching Free"}</span>
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}

                {supabaseUser ? (
                  <Link
                    href={watchHref({ category: "News" })}
                    className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-white/5 hover:bg-white/10 text-white text-sm font-semibold border border-white/15 hover:border-white/25 backdrop-blur-md transition flex items-center justify-center gap-2"
                  >
                    <Newspaper className="w-4 h-4 text-cyan-300" />
                    <span>Browse Live News</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => openAuthModal("signup")}
                    className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-white/5 hover:bg-white/10 text-white text-sm font-semibold border border-white/15 hover:border-white/25 backdrop-blur-md transition flex items-center justify-center gap-2"
                  >
                    <UserPlus className="w-4 h-4 text-cyan-300" />
                    <span>Create Free Account</span>
                  </button>
                )}
              </div>

              {/* Trust chips */}
              <div className="pt-2 flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 text-xs text-slate-400">
                {["No subscription", "Adaptive HLS 1080p", "Built-in CORS bypass", "Cloud sync"].map(
                  (item) => (
                    <span key={item} className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                      <span>{item}</span>
                    </span>
                  )
                )}
              </div>
            </div>

            {/* -------- Right: dynamic glassmorphism featured card -------- */}
            <div className="relative mx-auto w-full max-w-md lg:max-w-none">
              <div className="absolute -inset-4 bg-gradient-to-tr from-cyan-500/20 via-transparent to-purple-500/20 blur-2xl rounded-[2.5rem] pointer-events-none" />

              <div className="relative rounded-[2rem] p-5 sm:p-6 bg-white/[0.06] backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/60 ring-1 ring-white/5 overflow-hidden">
                {/* sheen */}
                <div className="absolute -top-24 -right-20 w-56 h-56 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />

                {/* Card header */}
                <div className="relative flex items-center justify-between mb-4">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px] font-black tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                    NOW FEATURED
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Spotlight
                  </span>
                </div>

                {/* Spotlight visual */}
                <div
                  key={featured.id}
                  className="relative rounded-2xl aspect-[16/10] overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-white/10 flex items-center justify-center p-8 animate-fade-in"
                >
                  {featured.logo ? (
                    <>
                      <img
                        src={featured.logo}
                        alt=""
                        aria-hidden
                        className="absolute inset-0 w-full h-full object-cover opacity-20 blur-2xl scale-110"
                      />
                      <img
                        src={featured.logo}
                        alt={featured.name}
                        className="relative max-h-full object-contain drop-shadow-2xl"
                      />
                    </>
                  ) : (
                    <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-xl font-black text-white">
                      {initialsOf(featured.name)}
                    </div>
                  )}

                  {/* Glassmorphism overlay strip */}
                  <div className="absolute bottom-0 left-0 right-0 p-3 bg-black/45 backdrop-blur-md border-t border-white/10 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-slate-200 truncate">
                      {featured.category || "General"} ·{" "}
                      {featured.country
                        ? `${countryFlag(featured.country)} ${countryLabel(featured.country)}`
                        : "🌐 Global"}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      HLS · FREE
                    </span>
                  </div>
                </div>

                {/* Spotlight info */}
                <div className="relative mt-4 space-y-4">
                  <div>
                    <h3 className="text-xl font-extrabold text-white tracking-tight truncate">
                      {cleanChannelTitle(featured.name)}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Part of a rotating spotlight — {featuredPool.length} hand-picked channels on
                      deck.
                    </p>
                  </div>

                  {watchCta(
                    "w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-black font-extrabold text-sm shadow-xl shadow-cyan-500/25 transition active:scale-[0.98] flex items-center justify-center gap-2",
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>Watch {cleanChannelTitle(featured.name)}</span>
                    </>
                  )}

                  {/* Rotation dots */}
                  <div className="flex items-center justify-center gap-1.5">
                    {featuredPool.slice(0, 7).map((c, i) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setFeaturedIndex(i)}
                        title={`Show ${c.name}`}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          i === featuredIndex % featuredPool.length
                            ? "w-6 bg-cyan-400"
                            : "w-1.5 bg-white/25 hover:bg-white/50"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* -------- Stats glass bar -------- */}
          <div className="relative mt-12 sm:mt-16 rounded-3xl bg-white/[0.04] backdrop-blur-xl border border-white/10 p-5 sm:p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5 sm:gap-6 text-center">
              {[
                { value: "30,000+", label: "Live TV channels", tint: "from-cyan-400 to-blue-500" },
                { value: "150+", label: "Countries & regions", tint: "from-indigo-400 to-purple-500" },
                { value: "$0 / mo", label: "Free forever", tint: "from-emerald-400 to-teal-500" },
                { value: "1080p", label: "Adaptive HLS quality", tint: "from-amber-400 to-rose-500" },
              ].map((stat) => (
                <div key={stat.label} className="space-y-1">
                  <div
                    className={`text-2xl sm:text-3xl font-extrabold tracking-tight bg-gradient-to-r ${stat.tint} bg-clip-text text-transparent`}
                  >
                    {stat.value}
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-400 font-medium">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* =========================== QUICK FILTERS ============================= */}
      <section id="browse" className="py-14 sm:py-16 relative scroll-mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-7">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold border border-cyan-500/20 mb-3">
                <Flame className="w-3.5 h-3.5" />
                Quick Browse
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                Jump straight to your category
              </h2>
              <p className="text-sm text-slate-400 mt-2 max-w-xl">
                Tap a chip to filter the grid instantly — every card opens the player with that
                channel preloaded.
              </p>
            </div>

            <Link
              href={watchHref()}
              className="inline-flex items-center gap-2 self-start px-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 transition"
            >
              <Search className="w-4 h-4 text-cyan-400" />
              <span>Search all 30,000+ channels</span>
            </Link>
          </div>

          {/* Category chips + country-wise filter bar */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
              {CHIPS.map((chip, idx) => {
                const Icon = chip.icon;
                const isActive = activeChip === idx;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => selectChip(idx)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap border transition-all duration-200 ${
                      isActive
                        ? "bg-gradient-to-r from-cyan-400 to-blue-600 text-black border-cyan-300 shadow-lg shadow-cyan-500/25 scale-[1.03]"
                        : "bg-white/5 hover:bg-white/10 text-slate-300 border-white/10 hover:border-white/20"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{chip.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Country filter — instantly filters the grid & search results */}
            <CountryFilter
              countries={countries}
              selected={selectedCountry}
              onSelect={setSelectedCountry}
            />
          </div>

          {/* Filtered grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {activeChipSpec.api && !catalog[catalogKey(activeChipSpec.api, selectedCountry)] ? (
              <TileSkeletons count={6} className="w-full" />
            ) : (
              gridChannels.slice(0, 12).map((channel) => (
                <ChannelTile key={`grid-${activeChipSpec.id}-${channel.id}`} channel={channel} />
              ))
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing <span className="text-slate-300 font-semibold">{activeChipSpec.label}</span>
              {selectedCountry !== "All" && (
                <>
                  {" · "}
                  <span className="text-cyan-400 font-semibold">
                    {countryLabel(selectedCountry)}
                  </span>
                </>
              )}{" "}
              · {gridChannels.length} channels
            </span>
            <Link
              href={watchHref()}
              className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 font-semibold transition"
            >
              <span>Open the full player</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ============================= CAROUSELS =============================== */}
      <section id="featured-rails" className="pb-16 scroll-mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/10 text-purple-300 text-xs font-semibold border border-purple-500/20 mb-3">
                <Sparkles className="w-3.5 h-3.5" />
                Featured Rails
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                Curated live channels, ready to roll
              </h2>
            </div>
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              <span>Auto-refreshing catalog</span>
            </span>
          </div>

          {CAROUSELS.map((spec) => {
            const key = spec.api ? catalogKey(spec.api, selectedCountry) : "";
            const channels = (catalog[key] || fallbackForCountry(spec.api || "", selectedCountry))
              .filter((ch) => matchesCountry(ch.country, selectedCountry));
            return (
              <CategoryRow
                key={`${spec.id}-${selectedCountry}`}
                spec={spec}
                channels={channels}
                loading={!catalog[key]}
                country={selectedCountry}
              />
            );
          })}

          <div className="pt-2 text-center">
            <Link
              href={watchHref()}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-semibold text-white transition"
            >
              <span>Explore every category in the player</span>
              <ArrowRight className="w-4 h-4 text-cyan-400" />
            </Link>
          </div>
        </div>
      </section>

      {/* ============================== FEATURES =============================== */}
      <section className="py-16 sm:py-20 bg-[#0a0d14]/70 border-y border-white/5 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold border border-cyan-500/20">
              <Zap className="w-3.5 h-3.5" />
              Engineered For Reliability
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Why stream on StreamPulse?
            </h2>
            <p className="text-sm text-slate-400">
              Built with modern streaming technology to deliver smooth, uninterrupted live playback
              across all devices.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="p-5 rounded-3xl bg-slate-900/50 border border-slate-800/80 hover:border-cyan-500/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-cyan-500/5 space-y-3 group"
                >
                  <div
                    className={`w-11 h-11 rounded-2xl border flex items-center justify-center transition group-hover:scale-105 ${feature.tint}`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-white">{feature.title}</h3>
                  <p className="text-xs sm:text-[13px] text-slate-400 leading-relaxed">
                    {feature.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ================================= FAQ ================================= */}
      <section className="py-16 sm:py-20 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold border border-cyan-500/20">
            <HelpCircle className="w-3.5 h-3.5" />
            Frequently Asked Questions
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Common inquiries
          </h2>
        </div>

        <div className="space-y-3">
          {FAQS.map((faq, index) => {
            const isOpen = openFaq === index;
            return (
              <div
                key={faq.q}
                className={`rounded-2xl bg-slate-900/50 border overflow-hidden transition ${
                  isOpen ? "border-cyan-500/30" : "border-slate-800"
                }`}
              >
                <button
                  onClick={() => setOpenFaq(isOpen ? null : index)}
                  className="w-full px-5 py-4 text-left font-semibold text-sm text-white flex items-center justify-between gap-4"
                >
                  <span>{faq.q}</span>
                  <ChevronRight
                    className={`w-4 h-4 text-cyan-400 transition-transform ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  />
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

      {/* ============================ CTA BANNER =============================== */}
      <section className="py-16 relative overflow-hidden border-t border-white/5">
        <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-cyan-500/10 to-transparent pointer-events-none" />
        <div className="absolute left-1/4 -bottom-24 w-96 h-96 bg-indigo-600/15 rounded-full blur-[110px] pointer-events-none" />
        <div className="absolute right-1/4 -bottom-28 w-96 h-96 bg-cyan-600/12 rounded-full blur-[110px] pointer-events-none" />

        <div className="relative max-w-4xl mx-auto px-4 text-center">
          <div className="rounded-[2rem] bg-white/[0.05] backdrop-blur-2xl border border-white/10 p-8 sm:p-12 shadow-2xl shadow-black/50">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[11px] font-semibold mb-5">
              <Lock className="w-3 h-3" />
              <span>{isSupabaseActive ? "Free account · takes under a minute" : "Supabase setup required"}</span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              Ready to start streaming?
            </h2>
            <p className="text-slate-400 text-sm sm:text-base max-w-xl mx-auto mt-3">
              {supabaseUser
                ? "Your account is ready — jump back into the player and keep watching where you left off."
                : "Create your free account (Google or email) and unlock the full live TV dashboard with cloud-synced favorites."}
            </p>

            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              {watchCta(
                "w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 text-black font-extrabold text-sm shadow-xl shadow-cyan-500/25 transition active:scale-95 flex items-center justify-center gap-2",
                <>
                  <Play className="w-5 h-5 fill-current" />
                  <span>{supabaseUser ? "Launch Live TV Dashboard" : "Start Watching Free"}</span>
                </>
              )}

              {!supabaseUser && (
                <button
                  type="button"
                  onClick={() => openAuthModal("signup")}
                  className="w-full sm:w-auto px-6 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-bold text-sm border border-white/15 transition flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-4 h-4 text-cyan-300" />
                  <span>Create account with email</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* =============================== FOOTER ================================ */}
      <footer className="border-t border-white/5 bg-slate-950 py-10 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center text-black font-bold">
              <Tv className="w-4 h-4" />
            </div>
            <span className="font-bold text-slate-300">StreamPulse IPTV</span>
            <span>•</span>
            <Link
              href="/developer"
              className="hover:text-cyan-400 transition"
              title="About the developer"
            >
              Developed by <span className="text-cyan-400 font-semibold">Sithum Thilina</span>
            </Link>
            <span className="hidden sm:inline">•</span>
            <span className="hidden sm:inline">Curated free-to-air live streams worldwide</span>
          </div>

          <div className="flex items-center gap-6 text-slate-400">
            <Link href={watchHref()} className="hover:text-cyan-400 transition">
              Watch TV
            </Link>
            <Link href="/categories" className="hover:text-cyan-400 transition">
              Categories
            </Link>
            <Link href="/developer" className="hover:text-cyan-400 transition">
              Developer
            </Link>
            <Link href="/about" className="hover:text-cyan-400 transition flex items-center gap-1">
              <span>About</span>
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
