"use client";

/**
 * Voice connection store.
 *
 * Discord-style: a user is "in" at most one voice channel at a time,
 * GLOBALLY across the whole shell. Switching to a text channel does
 * NOT leave voice. The only ways to leave are:
 *   1. Click 退出 / disconnect on the overlay
 *   2. Join another voice channel (auto-disconnects from the previous one)
 *
 * This store is purely UI state for now (no real WebRTC backend).
 *
 * NO PERSISTENCE: Refreshing the page must equal "leave all rooms and
 * start fresh" (user-requested). We deliberately do NOT use zustand's
 * `persist` middleware here — the previous build kept stale voice
 * connections across reloads and made debugging confusing.
 */

import { create } from "zustand";

export type VoiceConnection = {
  serverId: string;
  /** Channel id within the server (matches Channel.id from mock-data). */
  channelId: string;
  /** Display name for the overlay. */
  channelName: string;
  /** Where the user clicked join (timestamp ms). */
  joinedAt: number;
};

type VoiceStore = {
  current: VoiceConnection | null;
  /** Mic muted (don't transmit local audio). Shared across UI so the
   *  bottom voice panel and the channel page stay in sync. */
  muted: boolean;
  /** Deafened (don't play remote audio). UI-only for now. */
  deafened: boolean;
  /** Join (or switch). If already in another channel, that one is left first. */
  join: (conn: Omit<VoiceConnection, "joinedAt">) => void;
  /** Disconnect from the current voice channel (no-op if not connected). */
  leave: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
};

export const useVoice = create<VoiceStore>()((set) => ({
  current: null,
  muted: false,
  deafened: false,
  join: (conn) =>
    set({
      current: {
        ...conn,
        joinedAt: Date.now(),
      },
    }),
  leave: () => set({ current: null }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  toggleDeafen: () => set((s) => ({ deafened: !s.deafened })),
}));

// Defensive: scrub any leftover persisted state from older builds so
// users coming from a previous version actually get a clean refresh.
if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem("fl-voice");
  } catch {
    /* ignore */
  }
}

/** Convenience selector: are we currently connected to this exact channel? */
export const isConnectedTo = (
  current: VoiceConnection | null,
  serverId: string,
  channelId: string,
): boolean =>
  !!current &&
  current.serverId === serverId &&
  current.channelId === channelId;
