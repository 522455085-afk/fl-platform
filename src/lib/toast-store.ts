"use client";

/**
 * Lightweight ephemeral toast store for generic, fire-and-forget UI
 * feedback like "已复制", "保存成功", "网络错误，已重试" etc.
 *
 * This is intentionally separate from the announcement toasts handled
 * by HighPriorityWatcher — those are domain-specific (server-wide
 * realtime broadcasts with a banner style). Use this one for the small
 * "did you just click that button?" confirmations that should never
 * block or interrupt.
 *
 * Usage:
 *   import { toast } from "@/lib/toast-store";
 *   toast("已复制邀请码");
 *   toast.error("复制失败");
 */

import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export type Toast = {
  id: string;
  kind: ToastKind;
  text: string;
};

type Store = {
  toasts: Toast[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: string) => void;
};

export const useToastStore = create<Store>((set) => ({
  toasts: [],
  push: (kind, text) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    // Auto-dismiss after 2s — short enough to feel snappy, long enough
    // to read a short label.
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 2000);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Function-with-properties facade so callers can write `toast("...")`
// or `toast.error("...")` without importing the store directly.
function _toast(text: string) {
  useToastStore.getState().push("info", text);
}
_toast.success = (text: string) =>
  useToastStore.getState().push("success", text);
_toast.error = (text: string) =>
  useToastStore.getState().push("error", text);
_toast.info = (text: string) => useToastStore.getState().push("info", text);

export const toast = _toast;
