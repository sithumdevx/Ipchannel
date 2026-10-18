"use client";

import React, { createContext, useContext, useCallback, useEffect, useState } from "react";

/**
 * Lightweight dark/light theme switcher.
 *
 * The resolved theme is written to the `light` / `dark` class on <html>, where
 * `globals.css` swaps a set of `--sp-*` CSS variables. A tiny inline script in
 * the root layout applies the stored preference before first paint, so there
 * is no flash of the wrong theme.
 *
 * No external dependency (next-themes is not installed) — this is ~40 lines
 * and keeps the palette fully under our control.
 */

export type ThemeName = "dark" | "light";

interface ThemeContextType {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
}

const STORAGE_KEY = "streampulse_theme";

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return ctx;
}

/** Reads the stored preference; falls back to dark (the cinematic default). */
export function readStoredTheme(): ThemeName {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Seed from the DOM class the no-flash script already applied, so server and
  // first client render agree.
  const [theme, setThemeState] = useState<ThemeName>("dark");

  useEffect(() => {
    const html = document.documentElement;
    const initial: ThemeName = html.classList.contains("light") ? "light" : "dark";
    setThemeState(initial);
  }, []);

  const apply = useCallback((next: ThemeName) => {
    const html = document.documentElement;
    html.classList.toggle("light", next === "light");
    html.classList.toggle("dark", next === "dark");
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
  }, []);

  const setTheme = useCallback(
    (next: ThemeName) => {
      setThemeState(next);
      apply(next);
    },
    [apply]
  );

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeName = prev === "dark" ? "light" : "dark";
      apply(next);
      return next;
    });
  }, [apply]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
