"use client";

import React, { useState } from "react";
import { Play, Heart, Radio } from "lucide-react";
import { Channel } from "@/types/iptv";
import { countryFlag, countryLabel } from "@/lib/countries";
import { cleanChannelTitle } from "@/lib/channel-display";

interface ChannelCardProps {
  channel: Channel;
  isActive: boolean;
  isFavorite: boolean;
  onSelect: (channel: Channel) => void;
  onToggleFavorite: (channelId: string, e: React.MouseEvent) => void;
}

/**
 * Channel tile used across the browse grid and carousels.
 *
 * Carries a pulsing **LIVE** badge driven by the 5-minute stream verifier
 * (`channel.isLive`): a green ringed dot that breathes while the stream is
 * confirmed reachable. Channels not yet verified show a quieter amber "check"
 * state rather than claiming to be live.
 */
export default function ChannelCard({
  channel,
  isActive,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: ChannelCardProps) {
  const [imageError, setImageError] = useState(false);

  // Initials for avatar fallback
  const initials = channel.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "TV";

  // `undefined` = not probed yet this cycle; `true` = confirmed reachable.
  const live = channel.isLive === true;
  const unverified = channel.isLive === undefined;

  return (
    <div
      onClick={() => onSelect(channel)}
      className={`group relative flex flex-col justify-between p-3.5 rounded-2xl cursor-pointer transition-all duration-300 backdrop-blur-md border ${
        isActive
          ? "bg-gradient-to-b from-cyan-950/40 to-card border-cyan-500 shadow-lg shadow-cyan-500/20 scale-[1.02]"
          : "bg-card/70 hover:bg-card border-line hover:border-line2 hover:shadow-xl hover:shadow-shadow hover:-translate-y-1"
      }`}
    >
      {/* Top action row: Category tag, LIVE badge & Favorite Heart */}
      <div className="flex items-center justify-between gap-1 mb-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-chip text-dim border border-line max-w-[100px] truncate">
            {channel.category || "General"}
          </span>

          {/* Live status indicator — refreshed by the periodic health poll */}
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wide border ${
              live
                ? "bg-emerald-500/12 text-emerald-500 dark:text-emerald-400 border-emerald-500/30"
                : unverified
                  ? "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30"
                  : "bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30"
            }`}
            title={
              live
                ? "Stream verified within the last 5 minutes"
                : unverified
                  ? "Verification pending"
                  : "Stream currently unreachable"
            }
          >
            <span className="relative flex h-1.5 w-1.5">
              {live && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 animate-live-ring" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                  live ? "bg-emerald-500" : unverified ? "bg-amber-500" : "bg-rose-500"
                } ${live ? "animate-pulse" : ""}`}
              />
            </span>
            {live ? "LIVE" : unverified ? "CHECK" : "OFFLINE"}
          </span>
        </div>

        <button
          onClick={(e) => onToggleFavorite(channel.id, e)}
          className={`p-1.5 rounded-xl transition backdrop-blur-sm ${
            isFavorite
              ? "text-rose-500 bg-rose-500/10 hover:bg-rose-500/20"
              : "text-dim hover:text-rose-400 hover:bg-glass"
          }`}
          title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
        >
          <Heart className={`w-3.5 h-3.5 ${isFavorite ? "fill-current" : ""}`} />
        </button>
      </div>

      {/* Middle: Logo or Gradient Fallback */}
      <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-slate-950/70 border border-white/5 flex items-center justify-center p-3 mb-3 group-hover:border-white/10 transition">
        {channel.logo && !imageError ? (
          <img
            src={channel.logo}
            alt={channel.name}
            loading="lazy"
            onError={() => setImageError(true)}
            className="w-full h-full object-contain filter drop-shadow group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-600/30 via-indigo-600/30 to-purple-600/30 border border-white/10 flex items-center justify-center shadow-inner">
            <span className="font-extrabold text-sm tracking-wider text-slate-200">
              {initials}
            </span>
          </div>
        )}

        {/* Hover Overlay Play Icon */}
        <div
          className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center transition-opacity duration-200 ${
            isActive ? "opacity-100 bg-cyan-950/30" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-transform duration-200 ${
              isActive
                ? "bg-cyan-500 text-black scale-100"
                : "bg-white text-slate-950 group-hover:scale-110"
            }`}
          >
            {isActive ? (
              <Radio className="w-5 h-5 animate-pulse" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </div>
        </div>

        {/* Active stream ring indicator */}
        {isActive && (
          <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-[10px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            PLAYING
          </div>
        )}
      </div>

      {/* Bottom: Channel Info */}
      <div className="mt-auto">
        <h3
          className={`font-semibold text-xs leading-snug line-clamp-1 transition ${
            isActive ? "text-cyan-300" : "text-ink group-hover:text-ink"
          }`}
          title={channel.name}
        >
          {cleanChannelTitle(channel.name)}
        </h3>

        <div className="flex items-center justify-between text-[11px] text-dim mt-1">
          <span className="truncate">
            {channel.country ? `${countryFlag(channel.country)} ${countryLabel(channel.country)}` : "🌐 Global"}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-emerald-500 dark:text-emerald-400/90 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            HLS
          </span>
        </div>
      </div>
    </div>
  );
}
