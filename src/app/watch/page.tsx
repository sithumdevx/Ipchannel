"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Tv,
  Search,
  Heart,
  RotateCw,
  Flame,
  Newspaper,
  Trophy,
  Film,
  Music2,
  Smile,
  Compass,
  Baby,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Globe,
  Radio,
  ExternalLink,
  X,
  ArrowUp,
  User,
  History,
  Home,
} from "lucide-react";
import VideoPlayer from "@/components/VideoPlayer";
import ChannelCard from "@/components/ChannelCard";
import { Channel, ChannelsApiResponse } from "@/types/iptv";
import { FALLBACK_CHANNELS } from "@/lib/m3u-parser";
import { useProfile } from "@/context/ProfileContext";

const CHUNK_SIZE = 72;

const POPULAR_CATEGORIES = [
  { name: "All", icon: Flame },
  { name: "News", icon: Newspaper },
  { name: "Sports", icon: Trophy },
  { name: "Movies", icon: Film },
  { name: "Music", icon: Music2 },
  { name: "Documentary", icon: Compass },
  { name: "Animation", icon: Sparkles },
  { name: "Kids", icon: Baby },
  { name: "Entertainment", icon: Smile },
  { name: "Science", icon: Tv },
];

function WatchContent() {
  const searchParams = useSearchParams();
  const initialChannelId = searchParams.get("channel");
  const initialCategory = searchParams.get("category");

  const {
    currentProfile,
    setIsAuthModalOpen,
    toggleFavorite,
    addToHistory,
  } = useProfile();

  // Channel States
  const [allChannels, setAllChannels] = useState<Channel[]>(FALLBACK_CHANNELS);
  const [categories, setCategories] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(FALLBACK_CHANNELS[0]);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory || "All");
  const [selectedCountry, setSelectedCountry] = useState<string>("All");
  const [filterMode, setFilterMode] = useState<"all" | "favorites" | "history">("all");

  // Chunked rendering
  const [visibleCount, setVisibleCount] = useState<number>(CHUNK_SIZE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [showBackToTop, setShowBackToTop] = useState<boolean>(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Fetch all channels from API
  const loadAllChannels = useCallback(async (refresh = false) => {
    try {
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);

      const url = `/api/channels?all=true${refresh ? "&refresh=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load channels");

      const data: ChannelsApiResponse = await res.json();

      if (data.channels && data.channels.length > 0) {
        setAllChannels(data.channels);
        if (data.categories) setCategories(data.categories);
        if (data.countries) setCountries(data.countries);

        // If initialChannelId is specified in URL query
        if (initialChannelId) {
          const match = data.channels.find((c) => c.id === initialChannelId);
          if (match) {
            setSelectedChannel(match);
            addToHistory(match);
            return;
          }
        }

        setSelectedChannel((curr) => {
          if (curr && data.channels.some((c) => c.id === curr.id)) return curr;
          return data.channels[0];
        });
      }
    } catch (err) {
      console.error("Error loading channels:", err);
      if (allChannels.length === 0) {
        setAllChannels(FALLBACK_CHANNELS);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [allChannels.length, initialChannelId, addToHistory]);

  useEffect(() => {
    loadAllChannels(false);
  }, [loadAllChannels]);

  // Back to top scroll listener
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 600);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // When a channel is selected, add to watch history
  const handleSelectChannel = (channel: Channel) => {
    setSelectedChannel(channel);
    addToHistory(channel);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Full search & filtering across entire channel list
  const filteredChannels = useMemo(() => {
    let result = allChannels;

    // Filter mode
    if (filterMode === "favorites") {
      result = result.filter((ch) => currentProfile.favorites.includes(ch.id));
    } else if (filterMode === "history") {
      const historyIds = currentProfile.history.map((h) => h.channel.id);
      result = currentProfile.history.map((h) => h.channel);
    }

    // Category filter
    if (selectedCategory !== "All" && filterMode === "all") {
      const catLower = selectedCategory.toLowerCase();
      result = result.filter((ch) => ch.category.toLowerCase() === catLower);
    }

    // Country filter
    if (selectedCountry !== "All") {
      const countryLower = selectedCountry.toLowerCase();
      result = result.filter((ch) => ch.country?.toLowerCase() === countryLower);
    }

    // Multi-token search across all fields
    if (searchQuery.trim()) {
      const tokens = searchQuery
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      result = result.filter((ch) => {
        const name = ch.name.toLowerCase();
        const cat = ch.category.toLowerCase();
        const country = (ch.country || "").toLowerCase();
        const lang = (ch.language || "").toLowerCase();

        return tokens.every(
          (token) =>
            name.includes(token) ||
            cat.includes(token) ||
            country.includes(token) ||
            lang.includes(token)
        );
      });
    }

    return result;
  }, [
    allChannels,
    selectedCategory,
    selectedCountry,
    filterMode,
    currentProfile.favorites,
    currentProfile.history,
    searchQuery,
  ]);

  // Reset chunk count whenever filter changes
  useEffect(() => {
    setVisibleCount(CHUNK_SIZE);
  }, [searchQuery, selectedCategory, selectedCountry, filterMode]);

  // Visible sliced chunk
  const visibleChannels = useMemo(() => {
    return filteredChannels.slice(0, visibleCount);
  }, [filteredChannels, visibleCount]);

  // Infinite Scroll IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => {
            if (prev < filteredChannels.length) {
              return prev + CHUNK_SIZE;
            }
            return prev;
          });
        }
      },
      { rootMargin: "600px 0px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredChannels.length]);

  // Next / Prev Channel navigation
  const currentIndex = useMemo(() => {
    if (!selectedChannel) return -1;
    return filteredChannels.findIndex((c) => c.id === selectedChannel.id);
  }, [filteredChannels, selectedChannel]);

  const handleNextChannel = () => {
    if (filteredChannels.length === 0) return;
    if (currentIndex >= 0 && currentIndex < filteredChannels.length - 1) {
      handleSelectChannel(filteredChannels[currentIndex + 1]);
    } else {
      handleSelectChannel(filteredChannels[0]);
    }
  };

  const handlePrevChannel = () => {
    if (filteredChannels.length === 0) return;
    if (currentIndex > 0) {
      handleSelectChannel(filteredChannels[currentIndex - 1]);
    } else {
      handleSelectChannel(filteredChannels[filteredChannels.length - 1]);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#07080c] text-slate-100">
      {/* Top Glass Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#0a0d14]/85 backdrop-blur-xl border-b border-white/5 transition">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Logo & Navigation */}
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold border border-slate-800 transition"
              title="Return to Landing Page"
            >
              <Home className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Home</span>
            </Link>

            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <Tv className="w-4 h-4 text-white" />
              </div>
              <span className="font-extrabold text-base sm:text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent hidden sm:inline">
                StreamPulse TV
              </span>
            </Link>
          </div>

          {/* Search Bar */}
          <div className="flex-1 max-w-md relative hidden md:block">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder={`Search ${allChannels.length.toLocaleString()} channels...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-9 py-2 rounded-xl bg-slate-900/90 text-sm text-slate-200 placeholder-slate-500 border border-slate-800 focus:border-cyan-500/80 focus:ring-2 focus:ring-cyan-500/20 outline-none transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* User Profile, Favorites, History & Refresh */}
          <div className="flex items-center gap-2">
            {/* History Pill */}
            <button
              onClick={() => setFilterMode(filterMode === "history" ? "all" : "history")}
              className={`p-2 sm:px-3 sm:py-2 rounded-xl text-xs font-semibold transition border backdrop-blur-md flex items-center gap-1.5 ${
                filterMode === "history"
                  ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                  : "bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800"
              }`}
              title="Watch History"
            >
              <History className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">History</span>
            </button>

            {/* Favorites Pill */}
            <button
              onClick={() => setFilterMode(filterMode === "favorites" ? "all" : "favorites")}
              className={`p-2 sm:px-3 sm:py-2 rounded-xl text-xs font-semibold transition border backdrop-blur-md flex items-center gap-1.5 ${
                filterMode === "favorites"
                  ? "bg-rose-500/20 border-rose-500/40 text-rose-300"
                  : "bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800"
              }`}
              title="Favorite Channels"
            >
              <Heart className={`w-3.5 h-3.5 ${filterMode === "favorites" ? "fill-current" : ""}`} />
              <span className="hidden sm:inline">Favorites</span>
              {currentProfile.favorites.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-bold">
                  {currentProfile.favorites.length}
                </span>
              )}
            </button>

            {/* Profile Avatar & Switcher */}
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition"
              title="Manage Profile"
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
                  {currentProfile.name.substring(0, 1).toUpperCase()}
                </div>
              )}
              <span className="text-xs font-medium text-slate-200 hidden lg:inline max-w-[80px] truncate">
                {currentProfile.isGuest ? "Guest" : currentProfile.name}
              </span>
            </button>

            {/* Refresh */}
            <button
              onClick={() => loadAllChannels(true)}
              disabled={isRefreshing}
              className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white transition disabled:opacity-50"
              title="Re-fetch playlist"
            >
              <RotateCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-cyan-400" : ""}`} />
            </button>
          </div>
        </div>

        {/* Mobile Search Bar */}
        <div className="p-3 md:hidden border-t border-white/5 bg-slate-950/60">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={`Search ${allChannels.length.toLocaleString()} channels...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-900 text-xs text-slate-200 placeholder-slate-500 border border-slate-800 outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Featured Video Player */}
        {selectedChannel && (
          <section className="bg-gradient-to-b from-slate-900/80 to-slate-950/90 rounded-3xl p-4 sm:p-6 border border-white/10 shadow-2xl backdrop-blur-xl">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              {/* Player Container */}
              <div className="lg:col-span-2">
                <VideoPlayer
                  channel={selectedChannel}
                  onNextChannel={handleNextChannel}
                  onPrevChannel={handlePrevChannel}
                />
              </div>

              {/* Now Playing Details */}
              <div className="flex flex-col h-full justify-between gap-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                      <Radio className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
                      NOW STREAMING
                    </span>

                    <button
                      onClick={() => toggleFavorite(selectedChannel.id)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium border transition ${
                        currentProfile.favorites.includes(selectedChannel.id)
                          ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                          : "bg-slate-800/80 text-slate-400 hover:text-white border-slate-700"
                      }`}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${
                          currentProfile.favorites.includes(selectedChannel.id)
                            ? "fill-current text-rose-400"
                            : ""
                        }`}
                      />
                      <span>Favorite</span>
                    </button>
                  </div>

                  <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-snug">
                    {selectedChannel.name}
                  </h1>

                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="px-2.5 py-1 rounded-lg bg-slate-800/90 text-xs font-medium text-slate-300 border border-slate-700/60">
                      {selectedChannel.category}
                    </span>
                    {selectedChannel.country && (
                      <span className="px-2.5 py-1 rounded-lg bg-slate-800/90 text-xs font-medium text-slate-300 border border-slate-700/60">
                        {selectedChannel.country}
                      </span>
                    )}
                    {selectedChannel.language && (
                      <span className="px-2.5 py-1 rounded-lg bg-slate-800/90 text-xs font-medium text-slate-300 border border-slate-700/60">
                        {selectedChannel.language}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 p-3 rounded-xl bg-slate-950/60 border border-white/5 text-xs text-slate-400 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Stream Protocol:</span>
                      <span className="text-slate-300 font-mono">HLS (.m3u8)</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Buffer Tuning:</span>
                      <span className="text-cyan-400 font-mono text-[11px]">60s max / Auto Bitrate</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">CORS Support:</span>
                      <span className="text-emerald-400 font-medium">Bypass Proxy + Direct Segments</span>
                    </div>
                    <div className="flex items-center justify-between truncate">
                      <span className="text-slate-500">Stream Link:</span>
                      <a
                        href={selectedChannel.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-400/80 hover:text-cyan-300 flex items-center gap-1 font-mono text-[10px] max-w-[200px] truncate"
                      >
                        <span className="truncate">{selectedChannel.url}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      </a>
                    </div>
                  </div>
                </div>

                {/* Channel Navigation Buttons */}
                <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-3">
                  <button
                    onClick={handlePrevChannel}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous Channel
                  </button>
                  <button
                    onClick={handleNextChannel}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition shadow-lg shadow-cyan-600/20"
                  >
                    Next Channel
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Categories Bar & Quick Filter Pills */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Category horizontal scroll list */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none scroll-smooth">
              {POPULAR_CATEGORIES.map((cat) => {
                const IconComponent = cat.icon;
                const isActive = selectedCategory === cat.name && filterMode === "all";
                return (
                  <button
                    key={cat.name}
                    onClick={() => {
                      setSelectedCategory(cat.name);
                      setFilterMode("all");
                    }}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-200 border ${
                      isActive
                        ? "bg-cyan-500 text-black font-semibold border-cyan-400 shadow-lg shadow-cyan-500/20 scale-105"
                        : "bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <IconComponent className={`w-3.5 h-3.5 ${isActive ? "text-black" : "text-cyan-400"}`} />
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Country Selector Dropdown */}
            {countries.length > 0 && (
              <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
                <Globe className="w-4 h-4 text-slate-400" />
                <select
                  value={selectedCountry}
                  onChange={(e) => setSelectedCountry(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-slate-900/90 text-xs text-slate-300 border border-slate-800 outline-none focus:border-cyan-500 transition cursor-pointer"
                >
                  <option value="All">All Countries ({countries.length})</option>
                  {countries.slice(0, 80).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </section>

        {/* Channel Grid Section */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>Explore Channels</span>
                <span className="text-xs font-medium text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded-full border border-cyan-800/60">
                  {filteredChannels.length.toLocaleString()} matches
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Showing {Math.min(visibleCount, filteredChannels.length).toLocaleString()} of{" "}
                {filteredChannels.length.toLocaleString()} channels (from{" "}
                {allChannels.length.toLocaleString()} total in playlist)
              </p>
            </div>

            {(searchQuery || selectedCategory !== "All" || selectedCountry !== "All" || filterMode !== "all") && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("All");
                  setSelectedCountry("All");
                  setFilterMode("all");
                }}
                className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                Reset Filters
              </button>
            )}
          </div>

          {/* Loading Skeletons */}
          {isLoading && allChannels.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              {Array.from({ length: 18 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse bg-slate-900/60 rounded-2xl p-4 border border-slate-800 flex flex-col justify-between aspect-[3/4]"
                >
                  <div className="h-4 bg-slate-800 rounded w-16 mb-2" />
                  <div className="w-full aspect-[4/3] bg-slate-800 rounded-xl my-2" />
                  <div className="space-y-2 mt-2">
                    <div className="h-3.5 bg-slate-800 rounded w-3/4" />
                    <div className="h-3 bg-slate-800 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : visibleChannels.length === 0 ? (
            /* Empty State */
            <div className="py-16 flex flex-col items-center justify-center text-center bg-slate-900/40 rounded-3xl border border-dashed border-slate-800 p-8">
              <div className="w-16 h-16 rounded-2xl bg-slate-800/80 flex items-center justify-center mb-4 text-slate-400">
                <Tv className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-semibold text-white">No channels found</h3>
              <p className="text-sm text-slate-400 max-w-sm mt-1 mb-6">
                No channels match your current search or filter criteria.
              </p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("All");
                  setSelectedCountry("All");
                  setFilterMode("all");
                }}
                className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-lg shadow-cyan-600/30 transition"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            /* Chunked Infinite Scroll Grid */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              {visibleChannels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  isActive={selectedChannel?.id === channel.id}
                  isFavorite={currentProfile.favorites.includes(channel.id)}
                  onSelect={handleSelectChannel}
                  onToggleFavorite={(id, e) => {
                    e.stopPropagation();
                    toggleFavorite(id);
                  }}
                />
              ))}
            </div>
          )}

          {/* Sentinel / Load More */}
          {visibleCount < filteredChannels.length && (
            <div className="pt-8 pb-12 flex flex-col items-center justify-center gap-3">
              <div ref={sentinelRef} className="h-4 w-full" />
              <button
                onClick={() => setVisibleCount((prev) => prev + CHUNK_SIZE)}
                className="px-6 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 hover:border-slate-700 transition flex items-center gap-2"
              >
                <span>
                  Load More ({Math.min(visibleCount, filteredChannels.length).toLocaleString()} of{" "}
                  {filteredChannels.length.toLocaleString()})
                </span>
              </button>
            </div>
          )}
        </section>
      </main>

      {/* Floating Back to Top */}
      {showBackToTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 p-3 rounded-full bg-cyan-500 text-black shadow-2xl shadow-cyan-500/30 hover:scale-110 active:scale-95 transition z-50"
          title="Back to Top"
        >
          <ArrowUp className="w-5 h-5 font-bold" />
        </button>
      )}

      {/* Footer */}
      <footer className="border-t border-white/5 bg-slate-950/80 py-8 text-center text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 StreamPulse IPTV. Streams sourced legally from iptv-org repository.</p>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Next.js 16</span>
            <span>•</span>
            <span>HLS.js</span>
            <span>•</span>
            <span>Profile Sync</span>
            <span>•</span>
            <span>CORS Bypass Proxy</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#07080c] flex items-center justify-center text-slate-400">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
            <span className="text-sm">Loading StreamPulse TV...</span>
          </div>
        </div>
      }
    >
      <WatchContent />
    </Suspense>
  );
}
