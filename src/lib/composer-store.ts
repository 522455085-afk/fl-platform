"use client";

import { create } from "zustand";

type ComposerState = {
  draft: string;
  setDraft: (v: string | ((p: string) => string)) => void;
  placeholder: string;
  setPlaceholder: (p: string) => void;
  disabled: boolean;
  disabledReason: "guest" | "announcement" | "muted" | null;
  setDisabled: (
    disabled: boolean,
    reason?: "guest" | "announcement" | "muted" | null,
  ) => void;
  /** Whether the current context allows the user to mark outgoing messages
   *  as high-priority (admin + announcement channel only). Controls whether
   *  the desktop composer renders the "高优先级" pill. */
  canSetPriority: boolean;
  setCanSetPriority: (v: boolean) => void;
  /** Current outgoing-message priority. Reset to "normal" automatically
   *  after send() and on channel switch. */
  priority: "normal" | "high";
  setPriority: (p: "normal" | "high") => void;
};

export const useComposer = create<ComposerState>((set) => ({
  draft: "",
  setDraft: (v) =>
    set((s) => ({ draft: typeof v === "function" ? v(s.draft) : v })),
  placeholder: "发消息",
  setPlaceholder: (p) => set({ placeholder: p }),
  disabled: false,
  disabledReason: null,
  setDisabled: (disabled, reason = null) =>
    set({ disabled, disabledReason: reason }),
  canSetPriority: false,
  setCanSetPriority: (v) => set({ canSetPriority: v }),
  priority: "normal",
  setPriority: (p) => set({ priority: p }),
}));

/** Module-level ref so any component (ChatView, page bottom bar) can focus
 * the active composer textarea without prop-drilling. */
export const composerTextareaRef: { current: HTMLTextAreaElement | null } = {
  current: null,
};

/** Module-level ref pointing to the active channel's hidden file input.
 * Set by ChatView on mount; clicked by BottomBarComposer's attachment button. */
export const composerImageInputRef: { current: HTMLInputElement | null } = {
  current: null,
};

/** Module-level ref to ChatView.handleImagePick. Lets the BottomBarComposer
 * (rendered outside ChatView's section) and a document-level drop catcher
 * route drag-and-dropped images into the active composer's attachment slot
 * instead of letting the browser navigate away to the file URL. */
export const composerImageDropHandlerRef: {
  current: ((file: File) => void) | null;
} = { current: null };
