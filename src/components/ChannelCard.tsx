"use client";

import React, { useState } from "react";
import { Play, Heart, Radio, Tv } from "lucide-react";
import { Channel } from "@/types/iptv";

interface ChannelCardProps {
  channel: Channel;
  isActive: boolean;
  isFavorite: boolean;
  onSelect: (channel: Channel) => void;
  onToggleFavorite: (channelId: string, e: React.MouseEvent) => void;
}

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

  return (
    <div
      onClick={() => onSelect(channel)}
      className={`group relative flex flex-col justify-between p-3.5 rounded-2xl cursor-pointer transition-all duration-300 backdrop-blur-md border ${
        isActive
          ? "bg-gradient-to-b from-cyan-950/40 to-slate-900/90 border-cyan-500 shadow-lg shadow-cyan-500/20 scale-[1.02]"
          : "bg-slate-900/60 hover:bg-slate-800/80 border-slate-800/80 hover:border-slate-700/80 hover:shadow-xl hover:shadow-black/40 hover:-translate-y-1"
      }`}
    >
      {/* Top action row: Category tag & Favorite Heart */}
      <div className="flex items-center justify-between gap-1 mb-3">
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800/90 text-slate-300 border border-slate-700/60 max-w-[120px] truncate">
          {channel.category || "General"}
        </span>

        <button
          onClick={(e) => onToggleFavorite(channel.id, e)}
          className={`p-1.5 rounded-xl transition backdrop-blur-sm ${
            isFavorite
              ? "text-rose-500 bg-rose-500/10 hover:bg-rose-500/20"
              : "text-slate-400 hover:text-rose-400 hover:bg-white/5"
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
            isActive ? "text-cyan-300" : "text-slate-200 group-hover:text-white"
          }`}
          title={channel.name}
        >
          {channel.name}
        </h3>

        <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
          <span className="truncate">{channel.country || "Global"}</span>
          <span className="flex items-center gap-1 text-[10px] text-emerald-400/90 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            HLS
          </span>
        </div>
      </div>
    </div>
  );
}
