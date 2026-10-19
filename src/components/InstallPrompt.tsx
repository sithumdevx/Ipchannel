"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Download, X, Share, PlusSquare } from "lucide-react";

/**
 * The non-standard event Chromium fires when a site qualifies for installation.
 * Calling `prompt()` opens the native "Install app" dialog.
 * https://developer.mozilla.org/docs/Web/API/BeforeInstallPromptEvent
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "streampulse_install_dismissed_at";
const DISMISS_DAYS = 7;
const IOS_HINT_DELAY_MS = 4000;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

function isIOSDevice(): boolean {
  try {
    const ua = window.navigator.userAgent;
    // iPadOS 13+ reports as a Mac but is a touch device.
    const iPadOS = /Macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(ua) || iPadOS;
  } catch {
    return false;
  }
}

function isDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number.parseInt(raw, 10);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Floating "Install StreamPulse" banner.
 *
 * - Android / desktop Chromium: captures `beforeinstallprompt` and triggers the
 *   native install flow on click.
 * - iOS Safari: there is no programmatic prompt, so we show the Share → Add to
 *   Home Screen instructions instead.
 * - Hidden entirely once installed (standalone display mode) and for a week
 *   after the user dismisses it.
 */
export default function InstallPrompt() {
  // Both are session-constant, so they are resolved once on the first render.
  // The banner renders `null` until it is actually relevant, so the server and
  // client produce identical markup and there is no hydration mismatch.
  const [installed, setInstalled] = useState(isStandalone);
  const [isIOS] = useState(isIOSDevice);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (installed) return;
    if (isDismissedRecently()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      // Stop the browser's own mini-infobar and keep the event for our button.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const onInstalled = () => {
      setInstalled(true);
      setVisible(false);
      setDeferredPrompt(null);
      try {
        localStorage.removeItem(DISMISS_KEY);
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // iOS never fires beforeinstallprompt — surface the hint after a short beat
    // so it does not compete with the first paint / hero animation.
    const iosTimer = isIOS
      ? setTimeout(() => setVisible(true), IOS_HINT_DELAY_MS)
      : undefined;

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, [installed, isIOS]);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setVisible(false);
      } else {
        dismiss();
      }
    } catch {
      /* prompt failed — leave the banner up so the user can retry */
    } finally {
      setDeferredPrompt(null);
    }
  };

  if (installed || !visible) return null;
  // Nothing to offer: no native prompt captured and not iOS.
  if (!deferredPrompt && !isIOS) return null;

  return (
    <div
      role="dialog"
      aria-label="Install StreamPulse"
      className="animate-install-in fixed inset-x-3 bottom-3 z-40 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[26rem]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/85 p-3 pr-2 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="pointer-events-none absolute -top-10 -left-10 h-28 w-28 rounded-full bg-cyan-500/20 blur-2xl" />

        <Image
          src="/icons/icon-192.png"
          alt=""
          width={44}
          height={44}
          unoptimized
          className="relative h-11 w-11 flex-shrink-0 rounded-xl ring-1 ring-white/10"
        />

        <div className="relative min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">Install StreamPulse</p>
          {isIOS && !deferredPrompt ? (
            <p className="truncate text-xs text-slate-400">
              Tap <Share className="inline h-3 w-3 -mt-0.5 text-cyan-400" /> Share → Add to Home Screen
            </p>
          ) : (
            <p className="truncate text-xs text-slate-400">
              Full-screen live TV, right from your home screen.
            </p>
          )}
        </div>

        {isIOS && !deferredPrompt ? (
          <span className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/5 text-cyan-400 ring-1 ring-white/10">
            <PlusSquare className="h-4.5 w-4.5" />
          </span>
        ) : (
          <button
            type="button"
            onClick={handleInstall}
            className="relative flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-600 px-3.5 py-2 text-xs font-bold text-black shadow-lg shadow-cyan-500/30 transition hover:from-cyan-300 hover:to-blue-500 active:scale-95"
          >
            <Download className="h-3.5 w-3.5" />
            Install
          </button>
        )}

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
