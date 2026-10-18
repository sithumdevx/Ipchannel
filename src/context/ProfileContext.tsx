"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { Channel } from "@/types/iptv";

export interface UserProfile {
  id: string;
  name: string;
  avatarColor: string; // Tailwind gradient or color
  isGuest: boolean;
  favorites: string[];
  history: { channel: Channel; playedAt: number }[];
}

interface ProfileContextType {
  currentProfile: UserProfile;
  profiles: UserProfile[];
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  loginProfile: (name: string, avatarColor?: string) => void;
  continueAsGuest: () => void;
  switchProfile: (profileId: string) => void;
  toggleFavorite: (channelId: string) => void;
  addToHistory: (channel: Channel) => void;
  clearHistory: () => void;
}

const DEFAULT_GUEST: UserProfile = {
  id: "guest-profile",
  name: "Guest User",
  avatarColor: "from-cyan-500 to-blue-600",
  isGuest: true,
  favorites: [],
  history: [],
};

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<UserProfile[]>([DEFAULT_GUEST]);
  const [currentProfileId, setCurrentProfileId] = useState<string>("guest-profile");
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  // Load from localStorage on mount
  useEffect(() => {
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
      console.warn("Failed to load profiles", e);
    }
  }, []);

  // Save changes to localStorage
  const saveProfiles = (newProfiles: UserProfile[], activeId: string) => {
    setProfiles(newProfiles);
    setCurrentProfileId(activeId);
    try {
      localStorage.setItem("streampulse_profiles", JSON.stringify(newProfiles));
      localStorage.setItem("streampulse_active_profile", activeId);
    } catch (e) {
      console.warn("Failed to save profiles", e);
    }
  };

  const currentProfile =
    profiles.find((p) => p.id === currentProfileId) || profiles[0] || DEFAULT_GUEST;

  // Sign In / Create Profile
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

      saveProfiles([...profiles.filter((p) => !p.isGuest), newProf], newProf.id);
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

  // Toggle favorite channel for current profile
  const toggleFavorite = (channelId: string) => {
    const updated = profiles.map((p) => {
      if (p.id === currentProfile.id) {
        const isFav = p.favorites.includes(channelId);
        return {
          ...p,
          favorites: isFav
            ? p.favorites.filter((id) => id !== channelId)
            : [...p.favorites, channelId],
        };
      }
      return p;
    });

    saveProfiles(updated, currentProfile.id);
  };

  // Add channel to watch history
  const addToHistory = (channel: Channel) => {
    const updated = profiles.map((p) => {
      if (p.id === currentProfile.id) {
        const filteredHist = p.history.filter((h) => h.channel.id !== channel.id);
        return {
          ...p,
          history: [{ channel, playedAt: Date.now() }, ...filteredHist].slice(0, 30),
        };
      }
      return p;
    });

    saveProfiles(updated, currentProfile.id);
  };

  // Clear watch history
  const clearHistory = () => {
    const updated = profiles.map((p) => {
      if (p.id === currentProfile.id) {
        return { ...p, history: [] };
      }
      return p;
    });

    saveProfiles(updated, currentProfile.id);
  };

  return (
    <ProfileContext.Provider
      value={{
        currentProfile,
        profiles,
        isAuthModalOpen,
        setIsAuthModalOpen,
        loginProfile,
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
