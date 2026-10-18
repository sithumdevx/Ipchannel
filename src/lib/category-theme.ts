import type { ComponentType } from "react";
import {
  Baby,
  Banknote,
  Car,
  Church,
  CloudSun,
  Compass,
  Drama,
  Film,
  Flag,
  Gamepad2,
  Gavel,
  GraduationCap,
  HeartPulse,
  Landmark,
  MapPinned,
  Microscope,
  Mountain,
  Music2,
  Newspaper,
  Palette,
  Popcorn,
  Shield,
  ShoppingBag,
  Smile,
  Sparkles,
  Swords,
  Trophy,
  Tv,
  Users,
} from "lucide-react";

/**
 * Presentation theme for a channel category.
 *
 * Every entry pairs a recognisable icon with a vivid gradient so the
 * `/categories` grid feels like a designed poster wall rather than a list.
 * Matching is case-insensitive and substring-based, mirroring the fuzziness of
 * `normalizeCategory()` in the M3U parser.
 */
export interface CategoryTheme {
  icon: ComponentType<{ className?: string }>;
  /** Tailwind gradient classes for the card background. */
  gradient: string;
  /** Tailwind classes for the icon chip. */
  chip: string;
  tagline: string;
}

/** Palette rotation so neighbouring cards never share the same colour. */
const PALETTES = [
  "from-cyan-500 via-cyan-600 to-blue-700",
  "from-emerald-500 via-teal-600 to-green-700",
  "from-purple-500 via-violet-600 to-indigo-700",
  "from-fuchsia-500 via-pink-600 to-purple-700",
  "from-rose-500 via-red-600 to-rose-700",
  "from-amber-500 via-orange-600 to-red-600",
  "from-sky-500 via-blue-600 to-indigo-700",
  "from-lime-500 via-emerald-600 to-teal-700",
];

const CHIP_PALETTES = [
  "bg-cyan-400/15 text-cyan-300 border-cyan-300/30",
  "bg-emerald-400/15 text-emerald-300 border-emerald-300/30",
  "bg-purple-400/15 text-purple-300 border-purple-300/30",
  "bg-fuchsia-400/15 text-fuchsia-300 border-fuchsia-300/30",
  "bg-rose-400/15 text-rose-300 border-rose-300/30",
  "bg-amber-400/15 text-amber-300 border-amber-300/30",
  "bg-sky-400/15 text-sky-300 border-sky-300/30",
  "bg-lime-400/15 text-lime-300 border-lime-300/30",
];

/**
 * Exact-name themes for the categories the parser normalises to, plus the
 * common raw playlist spellings. Order matters: the first substring match wins.
 */
const THEMES: { match: string[]; theme: CategoryTheme }[] = [
  {
    match: ["news"],
    theme: {
      icon: Newspaper,
      gradient: "from-cyan-500 via-sky-600 to-blue-700",
      chip: "bg-cyan-400/15 text-cyan-300 border-cyan-300/30",
      tagline: "24/7 breaking news & world reports",
    },
  },
  {
    match: ["sport"],
    theme: {
      icon: Trophy,
      gradient: "from-emerald-500 via-green-600 to-teal-700",
      chip: "bg-emerald-400/15 text-emerald-300 border-emerald-300/30",
      tagline: "Live matches, motorsports & more",
    },
  },
  {
    match: ["movie", "cinema", "film"],
    theme: {
      icon: Film,
      gradient: "from-purple-500 via-violet-600 to-indigo-700",
      chip: "bg-purple-400/15 text-purple-300 border-purple-300/30",
      tagline: "Cinema, premieres & cult classics",
    },
  },
  {
    match: ["series", "drama", "soap"],
    theme: {
      icon: Drama,
      gradient: "from-fuchsia-500 via-pink-600 to-rose-600",
      chip: "bg-fuchsia-400/15 text-fuchsia-300 border-fuchsia-300/30",
      tagline: "Series, soaps & binge-worthy drama",
    },
  },
  {
    match: ["music", "mtv", "radio music"],
    theme: {
      icon: Music2,
      gradient: "from-rose-500 via-pink-600 to-fuchsia-700",
      chip: "bg-rose-400/15 text-rose-300 border-rose-300/30",
      tagline: "Music videos, concerts & charts",
    },
  },
  {
    match: ["kid", "child", "junior", "baby"],
    theme: {
      icon: Baby,
      gradient: "from-amber-400 via-orange-500 to-yellow-600",
      chip: "bg-amber-300/20 text-amber-200 border-amber-300/30",
      tagline: "Safe, fun channels for children",
    },
  },
  {
    match: ["anim", "cartoon", "anime"],
    theme: {
      icon: Sparkles,
      gradient: "from-violet-500 via-purple-600 to-fuchsia-700",
      chip: "bg-violet-400/15 text-violet-300 border-violet-300/30",
      tagline: "Cartoons & animated worlds",
    },
  },
  {
    match: ["entertain", "show", "variety"],
    theme: {
      icon: Popcorn,
      gradient: "from-fuchsia-500 via-purple-600 to-indigo-700",
      chip: "bg-fuchsia-400/15 text-fuchsia-300 border-fuchsia-300/30",
      tagline: "Reality, talk shows & variety",
    },
  },
  {
    match: ["document", "wild", "nature"],
    theme: {
      icon: Compass,
      gradient: "from-teal-500 via-emerald-600 to-green-700",
      chip: "bg-teal-400/15 text-teal-300 border-teal-300/30",
      tagline: "Nature, history & real-world stories",
    },
  },
  {
    match: ["science", "space", "tech", "knowledge"],
    theme: {
      icon: Microscope,
      gradient: "from-indigo-500 via-blue-600 to-cyan-700",
      chip: "bg-indigo-400/15 text-indigo-300 border-indigo-300/30",
      tagline: "Discovery, space & technology",
    },
  },
  {
    match: ["business", "finance", "news business", "market"],
    theme: {
      icon: Banknote,
      gradient: "from-lime-500 via-emerald-600 to-green-700",
      chip: "bg-lime-400/15 text-lime-300 border-lime-300/30",
      tagline: "Markets, business & finance",
    },
  },
  {
    match: ["comedy", "funny", "humor"],
    theme: {
      icon: Smile,
      gradient: "from-yellow-400 via-amber-500 to-orange-600",
      chip: "bg-yellow-300/20 text-yellow-200 border-yellow-300/30",
      tagline: "Stand-up, sitcoms & laughs",
    },
  },
  {
    match: ["relig", "faith", "church", "islam", "spirit"],
    theme: {
      icon: Church,
      gradient: "from-amber-600 via-amber-700 to-stone-700",
      chip: "bg-amber-400/15 text-amber-200 border-amber-400/30",
      tagline: "Faith, worship & spiritual programming",
    },
  },
  {
    match: ["weather"],
    theme: {
      icon: CloudSun,
      gradient: "from-sky-400 via-cyan-500 to-blue-600",
      chip: "bg-sky-300/20 text-sky-200 border-sky-300/30",
      tagline: "Forecasts & live weather coverage",
    },
  },
  {
    match: ["shop", "auction", "commerce"],
    theme: {
      icon: ShoppingBag,
      gradient: "from-rose-500 via-red-500 to-orange-600",
      chip: "bg-rose-400/15 text-rose-300 border-rose-300/30",
      tagline: "Shopping networks & live deals",
    },
  },
  {
    match: ["auto", "car", "motor"],
    theme: {
      icon: Car,
      gradient: "from-red-500 via-rose-600 to-orange-700",
      chip: "bg-red-400/15 text-red-300 border-red-300/30",
      tagline: "Motorsport & automotive TV",
    },
  },
  {
    match: ["travel", "tour", "adventure"],
    theme: {
      icon: MapPinned,
      gradient: "from-teal-400 via-cyan-500 to-sky-600",
      chip: "bg-teal-300/20 text-teal-200 border-teal-300/30",
      tagline: "Travel guides & destination shows",
    },
  },
  {
    match: ["game", "gaming", "esport"],
    theme: {
      icon: Gamepad2,
      gradient: "from-violet-500 via-indigo-600 to-blue-700",
      chip: "bg-violet-400/15 text-violet-300 border-violet-300/30",
      tagline: "Gaming culture & esports",
    },
  },
  {
    match: ["health", "medical", "wellness", "fitness"],
    theme: {
      icon: HeartPulse,
      gradient: "from-pink-500 via-rose-500 to-red-600",
      chip: "bg-pink-400/15 text-pink-300 border-pink-300/30",
      tagline: "Health, wellness & medical shows",
    },
  },
  {
    match: ["culture", "art", "lifestyle", "fashion"],
    theme: {
      icon: Palette,
      gradient: "from-purple-400 via-fuchsia-500 to-pink-600",
      chip: "bg-purple-300/20 text-purple-200 border-purple-300/30",
      tagline: "Arts, culture & lifestyle",
    },
  },
  {
    match: ["educat", "learning", "school"],
    theme: {
      icon: GraduationCap,
      gradient: "from-blue-500 via-indigo-600 to-violet-700",
      chip: "bg-blue-400/15 text-blue-300 border-blue-300/30",
      tagline: "Educational & documentary learning",
    },
  },
  {
    match: ["legal", "court", "law", "gavel"],
    theme: {
      icon: Gavel,
      gradient: "from-slate-500 via-slate-600 to-zinc-700",
      chip: "bg-slate-400/15 text-slate-200 border-slate-300/30",
      tagline: "Court TV & legal programming",
    },
  },
  {
    match: ["military", "defense", "war"],
    theme: {
      icon: Shield,
      gradient: "from-green-600 via-emerald-700 to-slate-800",
      chip: "bg-green-400/15 text-green-300 border-green-300/30",
      tagline: "Defense & military channels",
    },
  },
  {
    match: ["historic", "history", "war historic"],
    theme: {
      icon: Landmark,
      gradient: "from-amber-600 via-orange-700 to-red-800",
      chip: "bg-orange-400/15 text-orange-300 border-orange-300/30",
      tagline: "History & historical documentaries",
    },
  },
  {
    match: ["outdoor", "hunt", "fish", "wilderness"],
    theme: {
      icon: Mountain,
      gradient: "from-green-500 via-emerald-600 to-stone-700",
      chip: "bg-green-400/15 text-green-300 border-green-300/30",
      tagline: "Outdoor adventure & wilderness",
    },
  },
  {
    match: ["combat", "wrestl", "fight", "martial"],
    theme: {
      icon: Swords,
      gradient: "from-orange-500 via-red-600 to-rose-700",
      chip: "bg-orange-400/15 text-orange-300 border-orange-300/30",
      tagline: "Fighting sports & wrestling",
    },
  },
  {
    match: ["event", "special", "live channel"],
    theme: {
      icon: Flag,
      gradient: "from-cyan-500 via-teal-500 to-emerald-600",
      chip: "bg-cyan-400/15 text-cyan-300 border-cyan-300/30",
      tagline: "Special events & live coverage",
    },
  },
  {
    match: ["government", "parliament", "politic"],
    theme: {
      icon: Landmark,
      gradient: "from-blue-700 via-slate-700 to-slate-800",
      chip: "bg-blue-400/15 text-blue-200 border-blue-400/30",
      tagline: "Parliament & public affairs",
    },
  },
  {
    match: ["religious", "devotional"],
    theme: {
      icon: Church,
      gradient: "from-amber-700 via-yellow-800 to-stone-800",
      chip: "bg-amber-400/15 text-amber-200 border-amber-400/30",
      tagline: "Devotional & spiritual channels",
    },
  },
  {
    match: ["adult"],
    theme: {
      icon: Users,
      gradient: "from-slate-600 via-slate-700 to-black",
      chip: "bg-slate-500/20 text-slate-300 border-slate-400/30",
      tagline: "Restricted — not available on StreamPulse",
    },
  },
];

const FALLBACK_THEME: CategoryTheme = {
  icon: Tv,
  gradient: "from-slate-500 via-slate-600 to-slate-800",
  chip: "bg-slate-400/15 text-slate-300 border-slate-300/30",
  tagline: "Live channels, curated for you",
};

/** Deterministic palette pick so unknown categories still look varied. */
function hashedTheme(name: string): CategoryTheme {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const idx = hash % PALETTES.length;
  return {
    icon: FALLBACK_THEME.icon,
    gradient: PALETTES[idx],
    chip: CHIP_PALETTES[idx],
    tagline: FALLBACK_THEME.tagline,
  };
}

/** Resolve the presentation theme for a raw category name. */
export function categoryTheme(name: string): CategoryTheme {
  const lower = (name || "").toLowerCase();
  if (!lower.trim()) return FALLBACK_THEME;

  const hit = THEMES.find((entry) => entry.match.some((m) => lower.includes(m)));
  if (hit) return hit.theme;

  return hashedTheme(lower);
}

/** Icon-only helper (used in compact chips/pills). */
export function categoryIcon(name: string): ComponentType<{ className?: string }> {
  return categoryTheme(name).icon;
}
