"use client";

import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

/**
 * Sleek segmented dark/light switcher used in the app navbar.
 *
 * A glass pill with a sliding indicator so the swap feels physical rather than
 * an instant icon flip.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={`group relative flex items-center gap-0 p-1 rounded-2xl bg-glass border border-line2 backdrop-blur-md hover:border-cyan-400/50 transition-colors ${className}`}
    >
      {/* Sliding indicator behind the active icon */}
      <span
        className={`absolute top-1 bottom-1 w-[26px] rounded-xl bg-gradient-to-tr from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/30 transition-transform duration-300 ease-out ${
          isDark ? "left-1 translate-x-0" : "left-1 translate-x-[26px]"
        }`}
      />

      <span
        className={`relative z-10 w-[26px] h-[26px] flex items-center justify-center rounded-xl transition-colors duration-300 ${
          isDark ? "text-black" : "text-dim group-hover:text-ink"
        }`}
      >
        <Moon className="w-3.5 h-3.5" />
      </span>

      <span
        className={`relative z-10 w-[26px] h-[26px] flex items-center justify-center rounded-xl transition-colors duration-300 ${
          !isDark ? "text-white" : "text-dim group-hover:text-ink"
        }`}
      >
        <Sun className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}
