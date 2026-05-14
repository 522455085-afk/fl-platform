"use client";

/**
 * Per-user-per-server preferences (notifications, mute, privacy).
 *
 * Persisted entirely in `localStorage` — there is no backend table for these
 * yet because the notification system itself is not built. When we wire up
 * the real notification pipeline (push tokens, @mention scanner, …) we'll
 * migrate to a `server_prefs` collection, but the public hook signatures
 * here will stay the same so call sites don't change.
 *
 * Shape of the stored blob:
 *   localStorage.fl_server_prefs = {
 *     [serverId]: {
 *       muteUntil: number | null,        // epoch ms; null = not muted
 *       notify: "all" | "mention" | "none",
 *       notifyEveryone: boolean,         // accept @所有人 / @在线
 *       notifyRole: boolean,             // accept @角色 提及
 *       allowDMs: boolean,               // 隐私设置 → 允许 DM
 *     }
 *   }
 *
 * The store is initialized lazily on first access to avoid hydration
 * mismatches in Next.js SSR. We never write/read on the server.
 */

import { create } from "zustand";

const STORAGE_KEY = "fl_server_prefs";

export type NotifyLevel = "all" | "mention" | "none";

export type ServerPrefs = {
  /** Epoch ms; once `Date.now() > muteUntil` the mute auto-expires. */
  muteUntil: number | null;
  notify: NotifyLevel;
  /** Receive `@所有人` and `@在线成员` pings. */
  notifyEveryone: boolean;
  /** Receive `@<role>` pings. */
  notifyRole: boolean;
  /** Allow other server members to DM me. */
  allowDMs: boolean;
};

const DEFAULTS: ServerPrefs = {
  muteUntil: null,
  notify: "mention",
  notifyEveryone: true,
  notifyRole: true,
  allowDMs: true,
};

type Store = {
  /** Map of serverId → user preferences (sparse — only set servers appear). */
  prefs: Record<string, ServerPrefs>;
  hydrated: boolean;
  hydrate: () => void;
  /** Read merged with defaults — always returns a complete object. */
  get: (serverId: string) => ServerPrefs;
  set: (serverId: string, patch: Partial<ServerPrefs>) => void;
  /** Convenience: mute for `durationMs` from now (or unmute when null). */
  mute: (serverId: string, durationMs: number | null) => void;
  /** Returns true if currently muted (and the deadline hasn't passed). */
  isMuted: (serverId: string) => boolean;
};

function loadAll(): Record<string, ServerPrefs> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function persistAll(prefs: Record<string, ServerPrefs>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode — ignore */
  }
}

export const useServerPrefs = create<Store>()((set, get) => ({
  prefs: {},
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ prefs: loadAll(), hydrated: true });
  },

  get: (serverId) => {
    const cur = get().prefs[serverId];
    return cur ? { ...DEFAULTS, ...cur } : { ...DEFAULTS };
  },

  set: (serverId, patch) => {
    const cur = get().get(serverId);
    const next = { ...cur, ...patch };
    const prefs = { ...get().prefs, [serverId]: next };
    set({ prefs });
    persistAll(prefs);
  },

  mute: (serverId, durationMs) => {
    const muteUntil = durationMs == null ? null : Date.now() + durationMs;
    get().set(serverId, { muteUntil });
  },

  isMuted: (serverId) => {
    const cur = get().prefs[serverId];
    if (!cur || !cur.muteUntil) return false;
    return Date.now() < cur.muteUntil;
  },
}));

/** Hook that returns the prefs for a server (auto-hydrates on first use). */
export function useServerPref(serverId: string | null): ServerPrefs {
  const hydrated = useServerPrefs((s) => s.hydrated);
  const hydrate = useServerPrefs((s) => s.hydrate);
  const prefs = useServerPrefs((s) => s.prefs);
  if (typeof window !== "undefined" && !hydrated) {
    // Lazy hydration — runs once. Reading inside the selector is fine for
    // zustand because hydrate() triggers a state update and re-render.
    hydrate();
  }
  if (!serverId) return { ...DEFAULTS };
  const cur = prefs[serverId];
  return cur ? { ...DEFAULTS, ...cur } : { ...DEFAULTS };
}
