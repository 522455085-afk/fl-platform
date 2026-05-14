"use client";

/**
 * Presence-status state machine.
 *
 * Two manual statuses (user-selectable from UserPanel):
 *   - "online" (绿点)
 *   - "away"   (黄点 — 主动设置 / 5 分钟内无输入自动)
 *
 * "offline" is NOT manually selectable — it's derived externally by other
 * clients when our presence row's `expires_at` elapses (heartbeat stops).
 *
 * "invisible" is reserved for future. Not exposed yet.
 *
 * Auto-away rule: if the user hasn't manually picked a status AND there's
 * been no input event (mousemove / keydown / pointerdown / wheel / touch)
 * for `IDLE_THRESHOLD_MS`, the *effective* status flips to "away". Any new
 * input flips it back to "online" instantly.
 *
 * Manual override (user clicks "在线" or "离开" in UserPanel) wins over
 * idle detection until they switch back to "auto" — which currently isn't
 * exposed in the UI; choosing "在线" while idle simply resets the activity
 * clock so it stays online for another 5 min.
 */

import { create } from "zustand";
import { useEffect } from "react";

export type ManualStatus = "online" | "away";
export type EffectiveStatus = "online" | "away";

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min
const TICK_MS = 30_000; // re-evaluate idle every 30s

type StatusState = {
  /** What the user clicked. `null` = follow auto-idle detection. */
  manual: ManualStatus | null;
  /** Last time any user input was observed. Used for auto-away. */
  lastActivityAt: number;
  /** Cached effective status — recomputed by the bootstrap tick. */
  effective: EffectiveStatus;
  setManual: (s: ManualStatus | null) => void;
  noteActivity: () => void;
  recomputeEffective: () => void;
};

export const usePresenceStatus = create<StatusState>()((set, get) => ({
  manual: null,
  lastActivityAt: Date.now(),
  effective: "online",

  setManual: (s) => {
    // Picking "online" also resets the activity clock so the auto-idle
    // grace window restarts from this moment.
    const lastActivityAt = s === "online" ? Date.now() : get().lastActivityAt;
    set({ manual: s, lastActivityAt });
    get().recomputeEffective();
  },

  noteActivity: () => {
    const now = Date.now();
    // Cheap throttle: only update state if it's been >=2s since last bump
    // so high-frequency mousemove doesn't cause re-render storms.
    if (now - get().lastActivityAt < 2_000) return;
    set({ lastActivityAt: now });
    // If the user is currently in auto mode and was idle, this activity
    // should flip them back to online immediately.
    if (get().manual === null && get().effective !== "online") {
      set({ effective: "online" });
    }
  },

  recomputeEffective: () => {
    const { manual, lastActivityAt, effective } = get();
    let next: EffectiveStatus;
    if (manual !== null) {
      next = manual; // explicit override
    } else {
      next =
        Date.now() - lastActivityAt >= IDLE_THRESHOLD_MS ? "away" : "online";
    }
    if (next !== effective) set({ effective: next });
  },
}));

/**
 * Mount once at the app root (AuthBootstrap). Wires up:
 *   - global input listeners → noteActivity
 *   - 30s tick → recomputeEffective (so we flip to "away" without input)
 */
export function usePresenceStatusBootstrap() {
  const noteActivity = usePresenceStatus((s) => s.noteActivity);
  const recompute = usePresenceStatus((s) => s.recomputeEffective);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "wheel",
      "touchstart",
    ];
    const handler = () => noteActivity();
    for (const e of events) {
      window.addEventListener(e, handler, { passive: true });
    }
    const tickId = setInterval(recompute, TICK_MS);
    return () => {
      for (const e of events) window.removeEventListener(e, handler);
      clearInterval(tickId);
    };
  }, [noteActivity, recompute]);
}
