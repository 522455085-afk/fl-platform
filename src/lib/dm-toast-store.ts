"use client";

/**
 * Bottom-right DM popup queue.
 *
 * Distinct from `toast-store` (which handles short "已复制" / error
 * blips) because incoming DMs deserve a richer card: sender avatar +
 * name + message preview + a click target that opens the DM thread.
 *
 * Cards self-dismiss after ~6s; users can also click the X. The list
 * is capped to keep the corner readable when many DMs land at once.
 */

import { create } from "zustand";

export type DmToast = {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerAvatar: string;
  partnerColor: string;
  partnerAvatarUrl?: string | null;
  preview: string;
};

type Store = {
  toasts: DmToast[];
  push: (t: Omit<DmToast, "id">) => void;
  dismiss: (id: string) => void;
};

const AUTO_DISMISS_MS = 6000;
const MAX_VISIBLE = 4;

export const useDmToastStore = create<Store>((set) => ({
  toasts: [],
  push: (t) => {
    const id = `dmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    set((s) => {
      // Coalesce: if a toast from the same partner is already showing,
      // replace it with the newer preview rather than stacking copies.
      const filtered = s.toasts.filter((x) => x.partnerId !== t.partnerId);
      const next = [...filtered, { ...t, id }];
      return { toasts: next.slice(-MAX_VISIBLE) };
    });
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, AUTO_DISMISS_MS);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
