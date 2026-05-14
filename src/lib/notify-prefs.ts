"use client";

/**
 * Per-device user preferences that control which notifications fire.
 * Stored in localStorage so they survive reloads but don't sync across
 * devices (intentional — "mute everything on my phone" shouldn't mute
 * the desktop client).
 *
 * Currently exposes:
 *   - mentionSound: should the audible ding play on @mention?
 *   - browserNotifyEnabled: should the OS notification appear on
 *     @mention while the tab is hidden?
 *
 * Use the hook for reactive reads in UI; the imported `notifyPrefs`
 * object for one-off non-reactive reads from utility code.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type State = {
  mentionSound: boolean;
  browserNotifyEnabled: boolean;
  setMentionSound: (v: boolean) => void;
  setBrowserNotifyEnabled: (v: boolean) => void;
};

export const useNotifyPrefs = create<State>()(
  persist(
    (set) => ({
      mentionSound: true,
      browserNotifyEnabled: true,
      setMentionSound: (v) => set({ mentionSound: v }),
      setBrowserNotifyEnabled: (v) => set({ browserNotifyEnabled: v }),
    }),
    {
      name: "fl_notify_prefs_v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : (undefined as never),
      ),
    },
  ),
);

/** Imperative accessor for non-React call sites. */
export const notifyPrefs = {
  mentionSound: () => useNotifyPrefs.getState().mentionSound,
  browserNotifyEnabled: () => useNotifyPrefs.getState().browserNotifyEnabled,
};
