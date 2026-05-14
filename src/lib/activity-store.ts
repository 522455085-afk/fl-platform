"use client";

/**
 * User activity status ("正在玩 X", "正在听 Y", "正在看 Z").
 *
 * Two input sources:
 *   1. Manual — user types a custom status in UserPanel.
 *   2. Automatic — the FL game client (or future integrations) POSTs
 *      to `setActivity()` via the FL_GAME_API_SPEC bridge.
 *
 * Manual wins over automatic until the user clears it. Priority is
 * tracked by a `source` tag so incoming game pings don't clobber a
 * manual override.
 *
 * Persisted to localStorage so the string survives reloads — activity
 * feels broken if it resets every refresh.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ActivitySource = "manual" | "game" | "auto";

type ActivityState = {
  /** Display string. Empty = no activity badge. */
  activity: string;
  /** Which subsystem set the current value. Manual overrides others. */
  source: ActivitySource;
  /** Update from the user's own typing. Overrides any active game status. */
  setManual: (text: string) => void;
  /** Update from the FL game bridge. Ignored when a manual string is set. */
  setFromGame: (text: string) => void;
  /** Wipe — returns to no activity, unlocks game updates. */
  clear: () => void;
};

export const useActivityStore = create<ActivityState>()(
  persist(
    (set, get) => ({
      activity: "",
      source: "auto",

      setManual: (text) => {
        const trimmed = text.trim().slice(0, 80); // hard cap length
        set({ activity: trimmed, source: "manual" });
      },

      setFromGame: (text) => {
        if (get().source === "manual" && get().activity) return;
        const trimmed = (text || "").trim().slice(0, 80);
        set({ activity: trimmed, source: "game" });
      },

      clear: () => set({ activity: "", source: "auto" }),
    }),
    {
      name: "fl:activity",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/**
 * Expose `window.__flSetActivity(text, source?)` and
 * `window.__flClearActivity()` so the game / native wrapper can push or
 * clear activity updates from outside React. Called from AuthBootstrap
 * once at mount.
 *
 * Usage (from desktop client / WebView bridge):
 *   window.__flSetActivity("正在玩 三角洲行动", "game")
 *   window.__flClearActivity()
 */
export function installActivityBridge() {
  if (typeof window === "undefined") return;
  
  // Define the window extension interface
  type FlBridge = {
    __flSetActivity?: (text: string, source?: ActivitySource) => void;
    __flClearActivity?: () => void;
  };
  
  const w = window as Window & FlBridge;

  w.__flSetActivity = (text: string, source?: ActivitySource) => {
    const store = useActivityStore.getState();
    if (source === "manual") store.setManual(text);
    else store.setFromGame(text);
  };

  /** Clear whatever activity is currently shown (call on game exit / idle). */
  w.__flClearActivity = () => {
    useActivityStore.getState().clear();
  };
}
