"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { Channel } from "@/types/iptv";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  avatarColor: string;
  useGoogleAvatar?: boolean;
  isGuest: boolean;
  favorites: string[];
  history: { channel: Channel; playedAt: number }[];
}

/**
 * Result of an email/password auth attempt. Returned instead of thrown so the
 * AuthModal can render precise feedback (e.g. "confirm your inbox" vs an
 * invalid-credentials error) without try/catch noise.
 */
export interface AuthActionResult {
  ok: boolean;
  /** Sign-up succeeded but Supabase still requires email confirmation. */
  needsEmailConfirmation?: boolean;
  message?: string;
}

interface ProfileContextType {
  currentProfile: UserProfile;
  profiles: UserProfile[];
  supabaseUser: User | null;
  isSupabaseActive: boolean;
  /** True once the restored session (or its absence) has been resolved. */
  isAuthReady: boolean;
  isAuthModalOpen: boolean;
  /** Which panel the modal opens on: "signin" or "signup". */
  authModalView: "signin" | "signup";
  isAuthSubmitting: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  openAuthModal: (view?: "signin" | "signup") => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<AuthActionResult>;
  signUpWithEmail: (
    username: string,
    email: string,
    password: string
  ) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
  updateProfile: (newName: string, avatarColor: string, useGooglePhoto: boolean) => Promise<void>;
  clearAllFavorites: () => Promise<void>;
  toggleFavorite: (channelId: string) => Promise<void>;
  addToHistory: (channel: Channel) => void;
  clearHistory: () => void;
}

/**
 * Unauthenticated placeholder profile.
 *
 * Guest mode was removed: this object only exists so `currentProfile` is never
 * `undefined` before the first session resolves (and for SSR/prerender). Every
 * real route in the app is gated behind an authenticated Supabase session by
 * `<AuthGate />`.
 */
const DEFAULT_GUEST: UserProfile = {
  id: "guest-profile",
  name: "Guest User",
  avatarColor: "from-cyan-500 to-blue-600",
  useGoogleAvatar: false,
  isGuest: true,
  favorites: [],
  history: [],
};

/** Human-friendly copy for Supabase auth errors. */
function friendlyAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login credentials")) return "Incorrect email or password.";
  if (m.includes("email not confirmed")) return "Please confirm your email first — check your inbox for the link.";
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "An account with this email already exists — try signing in instead.";
  }
  if (m.includes("password should be at least") || m.includes("password is too short")) {
    return "Password must be at least 8 characters long.";
  }
  if (m.includes("rate limit") || m.includes("too many") || m.includes("over_email_send_rate_limit")) {
    return "Too many attempts — please wait a minute and try again.";
  }
  if (m.includes("validate email") || m.includes("invalid email")) {
    return "Please enter a valid email address.";
  }
  return raw;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

/** Pages that are pure marketing/landing views — never the channel experience. */
const LANDING_PATHS = ["/", "/developer", "/about"];

function isLandingPath(pathname: string | null): boolean {
  return Boolean(pathname && LANDING_PATHS.includes(pathname));
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<UserProfile[]>([DEFAULT_GUEST]);
  const [currentProfileId, setCurrentProfileId] = useState<string>("guest-profile");
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalView, setAuthModalView] = useState<"signin" | "signup">("signin");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState<boolean>(false);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const isSupabaseActive = isSupabaseConfigured();

  /**
   * Open the auth modal on a specific panel ("signin" defaults).
   * This is the single entry point for every "sign in / create account" CTA
   * across the app.
   */
  const openAuthModal = useCallback((view: "signin" | "signup" = "signin") => {
    setAuthModalView(view);
    setIsAuthModalOpen(true);
  }, []);

  const router = useRouter();
  /**
   * Set to true once the first (restored) session has been resolved, so we can
   * tell a *fresh* sign-in apart from a normal page load of an already
   * signed-in user. Only fresh sign-ins trigger the post-login redirect.
   */
  const hasResolvedInitialSession = useRef(false);

  // Helper to persist profiles to localStorage
  const saveLocalProfiles = useCallback((newProfiles: UserProfile[], activeId: string) => {
    setProfiles(newProfiles);
    setCurrentProfileId(activeId);
    try {
      localStorage.setItem("streampulse_profiles", JSON.stringify(newProfiles));
      localStorage.setItem("streampulse_active_profile", activeId);
    } catch (e) {
      console.warn("Failed to save profiles to localStorage", e);
    }
  }, []);

  // Fetch favorites from Supabase table 'user_favorites'
  const fetchSupabaseFavorites = useCallback(async (userId: string): Promise<string[]> => {
    const supabase = getSupabase();
    if (!supabase) return [];

    try {
      const { data, error } = await supabase
        .from("user_favorites")
        .select("channel_id")
        .eq("user_id", userId);

      if (error) {
        console.warn("Could not fetch favorites from Supabase table 'user_favorites':", error.message);
        return [];
      }

      return data ? data.map((row: { channel_id: string }) => row.channel_id) : [];
    } catch (err) {
      console.warn("Error fetching Supabase favorites:", err);
      return [];
    }
  }, []);

  // Sync Supabase user session, metadata, and cloud favorites
  const syncSupabaseUser = useCallback(async (user: User) => {
    setSupabaseUser(user);

    const meta = user.user_metadata || {};
    // Display name first so users can rename themselves (updateProfile writes
    // `display_name`); `username` is the fallback handle for accounts that
    // never set one (e.g. Google sign-ups).
    const name =
      meta.display_name ||
      meta.username ||
      meta.full_name ||
      meta.name ||
      user.email?.split("@")[0] ||
      "User";

    const rawAvatarUrl = meta.avatar_url || meta.picture || undefined;
    const useGoogleAvatar = meta.use_google_avatar !== false && Boolean(rawAvatarUrl);
    const avatarColor = meta.avatar_color || "from-cyan-500 to-indigo-600";

    // Fetch cloud favorites
    const cloudFavorites = await fetchSupabaseFavorites(user.id);

    // Merge with any locally stored favorites from earlier sessions
    let localFavs: string[] = [];
    try {
      const saved = localStorage.getItem("iptv_favorites");
      if (saved) localFavs = JSON.parse(saved);
    } catch (e) {
      console.warn(e);
    }

    const mergedFavorites = Array.from(new Set([...cloudFavorites, ...localFavs]));

    const authenticatedProfile: UserProfile = {
      id: user.id,
      name,
      email: user.email,
      avatarUrl: useGoogleAvatar ? rawAvatarUrl : undefined,
      avatarColor,
      useGoogleAvatar,
      isGuest: false,
      favorites: mergedFavorites,
      history: [],
    };

    setProfiles((prev) => {
      const filtered = prev.filter((p) => p.id !== user.id && !p.isGuest);
      return [authenticatedProfile, ...filtered];
    });
    setCurrentProfileId(user.id);
  }, [fetchSupabaseFavorites]);

  /**
   * Post-login landing target: the main channel browsing/player view.
   * Only fires while the user is on a marketing page (Home hero, developer
   * page) so navigation inside the player itself is never hijacked.
   */
  const redirectToChannelView = useCallback(() => {
    if (typeof window === "undefined") return;
    if (isLandingPath(window.location.pathname)) {
      router.replace("/watch");
    }
  }, [router]);

  // Handle Supabase Auth Initialization and State Changes
  useEffect(() => {
    const supabase = getSupabase();

    // Load local profiles first
    try {
      const savedProfiles = localStorage.getItem("streampulse_profiles");
      const savedActiveId = localStorage.getItem("streampulse_active_profile");

      if (savedProfiles) {
        const parsed = JSON.parse(savedProfiles);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setProfiles(parsed);
        }
      }
      if (savedActiveId) {
        setCurrentProfileId(savedActiveId);
      }
    } catch (e) {
      console.warn("Failed to load local profiles", e);
    }

    // Supabase Auth listener
    if (supabase) {
      supabase.auth
        .getSession()
        .then(({ data: { session } }) => {
          if (session?.user) {
            syncSupabaseUser(session.user);
          }
        })
        .catch((err) => console.warn("Could not restore Supabase session", err))
        .finally(() => {
          // A restored session (or its absence) is NOT a fresh sign-in.
          hasResolvedInitialSession.current = true;
          setIsAuthReady(true);
        });

      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, session) => {
          if (session?.user) {
            syncSupabaseUser(session.user);

            // Fresh sign-in (Google OAuth return, magic link, in-tab sign-in):
            // send the user straight to the channel browser/player view
            // instead of leaving them on the Home hero landing page.
            if (event === "SIGNED_IN" && hasResolvedInitialSession.current) {
              setIsAuthModalOpen(false);
              redirectToChannelView();
            }
            hasResolvedInitialSession.current = true;
          } else if (event === "SIGNED_OUT") {
            setSupabaseUser(null);
            setCurrentProfileId("guest-profile");
          }
        }
      );

      return () => {
        subscription.unsubscribe();
      };
    }

    // Supabase isn't configured: there is no session to wait for, so release
    // the AuthGate immediately (it will show setup instructions).
    hasResolvedInitialSession.current = true;
    setIsAuthReady(true);
  }, [syncSupabaseUser, redirectToChannelView]);

  // Sign in with Google via Supabase OAuth
  const signInWithGoogle = async () => {
    const supabase = getSupabase();
    if (!supabase) {
      console.warn("Supabase is not configured yet. Please verify NEXT_PUBLIC_SUPABASE_URL and ANON key in .env.local");
      return;
    }

    // Always hand the user back to the channel browsing/player view after a
    // successful login, never to the Home hero landing page.
    const redirectUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent("/watch")}`
        : undefined;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      console.error("Google OAuth error:", error.message);
      throw error;
    }
  };

  /**
   * Email + password sign-in.
   * Supabase validates the credentials; `friendlyAuthError` turns the raw
   * provider message into something a user can act on.
   */
  const signInWithEmail = async (
    email: string,
    password: string
  ): Promise<AuthActionResult> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        ok: false,
        message: "Authentication is not configured yet. Add your Supabase URL and anon key to .env.local.",
      };
    }

    setIsAuthSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        return { ok: false, message: friendlyAuthError(error.message) };
      }
      // Success: the auth listener picks up the new session, closes the modal,
      // and redirects into the player.
      return { ok: true };
    } catch {
      return { ok: false, message: "Sign-in failed. Check your connection and try again." };
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  /**
   * Email + username + password registration.
   * The username lives in Supabase Auth `user_metadata` (key `username`, plus
   * `display_name` for the Google/OAuth naming convention), which is readable
   * by the user through `auth.updateUser` / the dashboard and requires no
   * extra table.
   */
  const signUpWithEmail = async (
    username: string,
    email: string,
    password: string
  ): Promise<AuthActionResult> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        ok: false,
        message: "Authentication is not configured yet. Add your Supabase URL and anon key to .env.local.",
      };
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3) {
      return { ok: false, message: "Username must be at least 3 characters." };
    }

    setIsAuthSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            username: trimmedUsername,
            display_name: trimmedUsername,
            avatar_color: "from-cyan-500 to-indigo-600",
            use_google_avatar: false,
          },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/watch")}`,
        },
      });

      if (error) {
        return { ok: false, message: friendlyAuthError(error.message) };
      }

      // No session => email confirmation is required before sign-in works.
      if (data.user && !data.session) {
        return {
          ok: true,
          needsEmailConfirmation: true,
          message: "Account created — check your inbox for a confirmation link, then sign in.",
        };
      }

      return { ok: true };
    } catch {
      return { ok: false, message: "Registration failed. Check your connection and try again." };
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  // Sign out
  const signOut = async () => {
    const supabase = getSupabase();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setSupabaseUser(null);
    setCurrentProfileId("guest-profile");
    localStorage.setItem("streampulse_active_profile", "guest-profile");
  };

  // Update Profile Name and Avatar settings
  const updateProfile = async (
    newName: string,
    avatarColor: string,
    useGooglePhoto: boolean
  ) => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    if (supabaseUser) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          await supabase.auth.updateUser({
            data: {
              display_name: trimmed,
              full_name: trimmed,
              avatar_color: avatarColor,
              use_google_avatar: useGooglePhoto,
            },
          });
        } catch (err) {
          console.warn("Could not sync metadata to Supabase auth:", err);
        }
      }
    }

    const rawGooglePhoto =
      supabaseUser?.user_metadata?.avatar_url || supabaseUser?.user_metadata?.picture;

    const updated = profiles.map((p) => {
      if (p.id === currentProfile.id) {
        return {
          ...p,
          name: trimmed,
          avatarColor,
          useGoogleAvatar: useGooglePhoto,
          avatarUrl: useGooglePhoto ? rawGooglePhoto || p.avatarUrl : undefined,
        };
      }
      return p;
    });

    saveLocalProfiles(updated, currentProfile.id);
  };

  // Clear all saved favorites (Supabase table + local storage)
  const clearAllFavorites = async () => {
    if (supabaseUser) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          await supabase
            .from("user_favorites")
            .delete()
            .eq("user_id", supabaseUser.id);
        } catch (err) {
          console.warn("Error deleting cloud favorites:", err);
        }
      }
    }

    const updated = profiles.map((p) => {
      if (p.id === currentProfile.id) {
        return { ...p, favorites: [] };
      }
      return p;
    });

    saveLocalProfiles(updated, currentProfile.id);
    try {
      localStorage.removeItem("iptv_favorites");
    } catch (e) {
      console.warn(e);
    }
  };

  // NOTE: `loginProfile` (local-only profiles), `continueAsGuest` and
  // `switchProfile` were removed together with guest mode — authentication is
  // now mandatory and handled exclusively by Supabase (Google OAuth or
  // email/password) via the AuthModal.

  // Toggle favorite channel (Syncs with Supabase if logged in, falls back to localStorage)
  const toggleFavorite = async (channelId: string) => {
    const current =
      profiles.find((p) => p.id === currentProfileId) || profiles[0] || DEFAULT_GUEST;
    const isFav = current.favorites.includes(channelId);
    const updatedFavorites = isFav
      ? current.favorites.filter((id) => id !== channelId)
      : [...current.favorites, channelId];

    // Optimistic update in state
    setProfiles((prev) =>
      prev.map((p) => {
        if (p.id === current.id) {
          return { ...p, favorites: updatedFavorites };
        }
        return p;
      })
    );

    // Save locally
    try {
      localStorage.setItem("iptv_favorites", JSON.stringify(updatedFavorites));
    } catch (e) {
      console.warn(e);
    }

    // If authenticated with Supabase, sync with user_favorites table
    if (supabaseUser) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          if (isFav) {
            await supabase
              .from("user_favorites")
              .delete()
              .eq("user_id", supabaseUser.id)
              .eq("channel_id", channelId);
          } else {
            await supabase.from("user_favorites").upsert(
              {
                user_id: supabaseUser.id,
                channel_id: channelId,
              },
              { onConflict: "user_id,channel_id" }
            );
          }
        } catch (dbErr) {
          console.warn("Supabase user_favorites sync error:", dbErr);
        }
      }
    }
  };

  // Add channel to watch history
  const addToHistory = (channel: Channel) => {
    const current =
      profiles.find((p) => p.id === currentProfileId) || profiles[0] || DEFAULT_GUEST;

    const filteredHist = current.history.filter((h) => h.channel.id !== channel.id);
    const updatedHist = [{ channel, playedAt: Date.now() }, ...filteredHist].slice(0, 30);

    setProfiles((prev) =>
      prev.map((p) => {
        if (p.id === current.id) {
          return { ...p, history: updatedHist };
        }
        return p;
      })
    );
  };

  // Clear watch history
  const clearHistory = () => {
    const current =
      profiles.find((p) => p.id === currentProfileId) || profiles[0] || DEFAULT_GUEST;

    setProfiles((prev) =>
      prev.map((p) => {
        if (p.id === current.id) {
          return { ...p, history: [] };
        }
        return p;
      })
    );
  };

  const currentProfile =
    profiles.find((p) => p.id === currentProfileId) || profiles[0] || DEFAULT_GUEST;

  return (
    <ProfileContext.Provider
      value={{
        currentProfile,
        profiles,
        supabaseUser,
        isSupabaseActive,
        isAuthReady,
        isAuthModalOpen,
        authModalView,
        isAuthSubmitting,
        setIsAuthModalOpen,
        openAuthModal,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        updateProfile,
        clearAllFavorites,
        toggleFavorite,
        addToHistory,
        clearHistory,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error("useProfile must be used within a ProfileProvider");
  }
  return context;
}
