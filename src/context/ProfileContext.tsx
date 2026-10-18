"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { User } from "@supabase/supabase-js";
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

interface ProfileContextType {
  currentProfile: UserProfile;
  profiles: UserProfile[];
  supabaseUser: User | null;
  isSupabaseActive: boolean;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  loginProfile: (name: string, avatarColor?: string) => void;
  updateProfile: (newName: string, avatarColor: string, useGooglePhoto: boolean) => Promise<void>;
  clearAllFavorites: () => Promise<void>;
  continueAsGuest: () => void;
  switchProfile: (profileId: string) => void;
  toggleFavorite: (channelId: string) => Promise<void>;
  addToHistory: (channel: Channel) => void;
  clearHistory: () => void;
}

const DEFAULT_GUEST: UserProfile = {
  id: "guest-profile",
  name: "Guest User",
  avatarColor: "from-cyan-500 to-blue-600",
  useGoogleAvatar: false,
  isGuest: true,
  favorites: [],
  history: [],
};

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<UserProfile[]>([DEFAULT_GUEST]);
  const [currentProfileId, setCurrentProfileId] = useState<string>("guest-profile");
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const isSupabaseActive = isSupabaseConfigured();

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
    const name =
      meta.display_name ||
      meta.full_name ||
      meta.name ||
      user.email?.split("@")[0] ||
      "User";

    const rawAvatarUrl = meta.avatar_url || meta.picture || undefined;
    const useGoogleAvatar = meta.use_google_avatar !== false && Boolean(rawAvatarUrl);
    const avatarColor = meta.avatar_color || "from-cyan-500 to-indigo-600";

    // Fetch cloud favorites
    const cloudFavorites = await fetchSupabaseFavorites(user.id);

    // Merge with any guest favorites if present
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
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          syncSupabaseUser(session.user);
        }
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, session) => {
          if (session?.user) {
            syncSupabaseUser(session.user);
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
  }, [syncSupabaseUser]);

  // Sign in with Google via Supabase OAuth
  const signInWithGoogle = async () => {
    const supabase = getSupabase();
    if (!supabase) {
      console.warn("Supabase is not configured yet. Please verify NEXT_PUBLIC_SUPABASE_URL and ANON key in .env.local");
      return;
    }

    const redirectUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname)}`
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

  // Sign In / Create Local Profile (for offline / local custom avatars)
  const loginProfile = (name: string, avatarColor?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const existing = profiles.find(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase() && !p.isGuest
    );

    if (existing) {
      setCurrentProfileId(existing.id);
      localStorage.setItem("streampulse_active_profile", existing.id);
    } else {
      const colors = [
        "from-purple-500 to-indigo-600",
        "from-emerald-500 to-teal-700",
        "from-rose-500 to-pink-600",
        "from-amber-500 to-orange-600",
        "from-cyan-500 to-blue-600",
      ];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      const newProf: UserProfile = {
        id: `user-${Date.now()}`,
        name: trimmed,
        avatarColor: avatarColor || randomColor,
        isGuest: false,
        favorites: [],
        history: [],
      };

      saveLocalProfiles([...profiles.filter((p) => !p.isGuest), newProf], newProf.id);
    }

    setIsAuthModalOpen(false);
  };

  // Continue as Guest
  const continueAsGuest = () => {
    setCurrentProfileId("guest-profile");
    localStorage.setItem("streampulse_active_profile", "guest-profile");
    setIsAuthModalOpen(false);
  };

  // Switch active profile
  const switchProfile = (profileId: string) => {
    if (profiles.some((p) => p.id === profileId)) {
      setCurrentProfileId(profileId);
      localStorage.setItem("streampulse_active_profile", profileId);
    }
  };

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
        isAuthModalOpen,
        setIsAuthModalOpen,
        signInWithGoogle,
        signOut,
        loginProfile,
        updateProfile,
        clearAllFavorites,
        continueAsGuest,
        switchProfile,
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
