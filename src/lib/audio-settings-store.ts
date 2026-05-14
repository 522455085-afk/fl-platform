"use client";

/**
 * Audio settings store.
 *
 * Holds the user-tunable volume levels for input (mic) and output
 * (other people's voice). Persisted to localStorage so settings
 * survive a refresh.
 *
 * NOTE: the values aren't yet wired to a real WebRTC pipeline — they
 * are surfaced in System Settings for forward compatibility, and the
 * VoiceConnectionOverlay's mute / deafen buttons fall back to clamping
 * input / output volumes to 0 when active.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

type AudioStore = {
  /** Mic input volume, 0..100. */
  inputVolume: number;
  /** Output volume, 0..100. */
  outputVolume: number;
  /** Master mute toggle (overrides per-call mute). */
  masterMuted: boolean;
  setInputVolume: (v: number) => void;
  setOutputVolume: (v: number) => void;
  setMasterMuted: (b: boolean) => void;
};

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export const useAudioSettings = create<AudioStore>()(
  persist(
    (set) => ({
      inputVolume: 100,
      outputVolume: 100,
      masterMuted: false,
      setInputVolume: (v) => set({ inputVolume: clamp(v) }),
      setOutputVolume: (v) => set({ outputVolume: clamp(v) }),
      setMasterMuted: (b) => set({ masterMuted: !!b }),
    }),
    { name: "fl-audio-settings" },
  ),
);
