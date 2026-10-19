"use client";

import { useEffect } from "react";

/**
 * Registers the StreamPulse service worker (PWA offline shell + installability).
 *
 * Production only: the worker caches navigations, and during `next dev` that
 * would serve stale pages while you edit. In development we also proactively
 * unregister anything an earlier production run left behind, so local testing
 * never inherits a stale cache.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.forEach((registration) => registration.unregister()))
        .catch(() => {
          /* nothing registered — fine */
        });
      return;
    }

    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
        console.warn("[StreamPulse] Service worker registration failed:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
