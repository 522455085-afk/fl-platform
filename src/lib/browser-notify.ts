"use client";

/**
 * Lightweight wrapper around the browser Notification + Web Audio APIs.
 *
 * Fires a native OS notification (only when the tab is hidden — when
 * it's visible the in-app toast/inbox already covers the case) and a
 * short beep so the user notices even with the tab muted in a
 * background window.
 *
 * Permission strategy:
 *   - We never auto-request on page load (too aggressive, browsers
 *     downrank sites that do it).
 *   - The first time something interesting happens (a real @mention
 *     for the current user), we request permission. If the user
 *     denies, we remember that and never beep again.
 *   - The user can also grant permission via OS / site settings;
 *     we'll pick that up on the next event automatically.
 *
 * Sound: synthesized via Web Audio so we don't need to ship an asset
 * or worry about autoplay policies (the API is gated on a user
 * gesture, but @mentions only happen after the user has already
 * interacted with the page, so this is fine in practice).
 */

import { notifyPrefs } from "@/lib/notify-prefs";

let audioCtx: AudioContext | null = null;
let primedOnGesture = false;

/** Lazily create / resume the shared AudioContext. */
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      // AudioContext constructor - use type-safe access
      const win = window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = win.AudioContext || win.webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      // Best-effort resume — Chrome requires a user gesture but
      // we're called from a click/keystroke aftermath in practice.
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Hook to call once at app root. Registers a one-shot listener that
 * primes (creates + resumes) the AudioContext on the user's first
 * real interaction. Without this, the first ding() triggered by an
 * incoming realtime event silently fails because the browser's
 * autoplay policy left the context in `suspended` state.
 */
if (typeof window !== "undefined") {
  const prime = () => {
    if (primedOnGesture) return;
    primedOnGesture = true;
    getAudioContext();
    window.removeEventListener("click", prime, true);
    window.removeEventListener("keydown", prime, true);
    window.removeEventListener("touchstart", prime, true);
  };
  window.addEventListener("click", prime, true);
  window.addEventListener("keydown", prime, true);
  window.addEventListener("touchstart", prime, true);
}

/**
 * Play a short two-tone "ding". ~120ms total. Volume kept low so it
 * isn't startling on speakers. Returns immediately; failures are
 * swallowed (no sound is acceptable; pop-up failure is the worst case).
 */
export function playMentionSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    gain.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    osc1.connect(gain);
    osc1.start(now);
    osc1.stop(now + 0.2);
  } catch {
    /* swallow — sound is a nice-to-have */
  }
}

const PERMISSION_DENIED_KEY = "fl_notify_denied_v1";

function userPreviouslyDenied(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(PERMISSION_DENIED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDenied() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PERMISSION_DENIED_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Show a browser notification for an @mention. Only fires when the
 * tab is hidden — otherwise the in-app inbox is enough. Also plays
 * the mention sound regardless of tab visibility (the sound is short
 * and quiet, and is the only feedback a muted background tab gets
 * before the user looks).
 */
export async function notifyMention(opts: {
  title: string;
  body: string;
  icon?: string;
  /** If provided, focuses that URL when the notification is clicked. */
  url?: string;
}) {
  // Honour the user's per-device preferences. Sound and OS popup are
  // toggled independently so a user can keep one off (e.g. mute the
  // ding but still get the popup, or vice-versa).
  if (notifyPrefs.mentionSound()) {
    playMentionSound();
  }
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (!notifyPrefs.browserNotifyEnabled()) return;
  if (userPreviouslyDenied()) return;

  let perm = Notification.permission;
  if (perm === "default") {
    try {
      perm = await Notification.requestPermission();
    } catch {
      return;
    }
    if (perm === "denied") {
      rememberDenied();
      return;
    }
  }
  if (perm !== "granted") return;

  // Only show the OS notification when the tab is not currently
  // visible — when it is, the in-app surface is more than enough.
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    return;
  }

  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      icon: opts.icon ?? "/icon-192.png",
      tag: "fl-mention",
      // `renotify` lives in the WhatWG spec but is not in TS's
      // lib.dom NotificationOptions yet — cast to bypass the
      // structural check. Browsers that don't recognise it ignore.
      ...({ renotify: true } as Record<string, unknown>),
    } as NotificationOptions);
    n.onclick = () => {
      window.focus();
      if (opts.url) {
        try { window.location.href = opts.url; } catch { /* ignore */ }
      }
      n.close();
    };
  } catch {
    /* swallow — some browsers throw on notification config issues */
  }
}
